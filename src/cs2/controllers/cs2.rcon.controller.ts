import { Controller, Post, Get, Body, Param, Res, HttpStatus, HttpCode, Headers, UnauthorizedException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { Cs2LifecycleService } from '../services/cs2.lifecycle.service';
import { Cs2RconService } from '../services/cs2.rcon.service';

@Controller('cs2')
export class Cs2Controller {

  private readonly logger = new Logger(Cs2Controller.name);

  constructor(
    private readonly cs2LifecycleService: Cs2LifecycleService,
    private readonly rconService: Cs2RconService
  ) {}

    /*
    TODOS:
    • EVENTS: Este endpoint recibe eventos en tiempo real de Matchzy (round_ended, por ejemplo).
    • REPORT: Este endpoint recibe un JSON completo de Matchzy con muchos datos, cada vez que se termina un mapa.
    • DEMO: Recibir la demo de un mapa, cuando este se termina.
  */

  //Poder escribir comandos, como si estuviéramos escribiendo en el cmd del server.
  @Post('cmd')
  async sendCustomCommand(@Body('command') command: string) {
    return await this.rconService.executeCommand(command);
  }


  /**
   * ENDPOINT 1: El que llamás vos desde Postman para iniciar el flujo de juego
   */
  @Post('start-match')
  @HttpCode(HttpStatus.OK)
  async startMatch(@Body() body: { matchId: string; config: any; port?: number }) {
    const port = body.port || 27015;
    await this.cs2LifecycleService.generarConfiguracionYPlantar(body.matchId, body.config, port);
    return { status: 'success', message: 'Servidor inicializado y RCON en cola' };
  }

  /**
   * ENDPOINT 2: El que consume MatchZy de forma interna para leer la configuración (GET)
   */
  @Get('config/:matchId')
  async getMatchConfig(@Param('matchId') matchId: string, @Res() res: Response) {
    const config = this.cs2LifecycleService.obtenerConfiguracionLocal(matchId);
    
    if (!config) {
      return res.status(HttpStatus.NOT_FOUND).json({ error: 'Configuración de partido no encontrada en el backend' });
    }

    return res.status(HttpStatus.OK).json(config);
  }

  /**
   * ENDPOINT 3: El webhook privado adonde MatchZy enviará todos los eventos del partido en vivo
   */
  @Post('events')
  @HttpCode(HttpStatus.OK)
  async handleMatchEvents(@Body() eventData: any, @Headers('authorization') authHeader: string) {
    // Validación de seguridad simple con el token inyectado por RCON
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Falta el token de autorización o es inválido');
    }
    
    const { event, matchid } = eventData;
    const gamePort = eventData.port || 27015; // Usamos el puerto que venga, o 27015 por defecto

    // Imprimimos CADA evento que llegue para debugar en vivo en la consola
    this.logger.log(`[Webhook MatchZy] Evento recibido: "${event}" para MatchID: ${matchid}`);


    // CASO 1: Terminó la serie completa
    if (event === 'series_end') {
      console.log(`--- [EVENTO] SERIE FINALIZADA (MatchID: ${matchid}) ---`);
      this.cs2LifecycleService.marcarSerieTerminada(matchid);
    }

    // CASO 2: La demo terminó de grabarse en disco
    if (event === 'demo_recording_stop') {
      console.log(`--- [EVENTO] DEMO GRABADA EN DISCO (MatchID: ${matchid}) ---`);
      
      // Validamos si la serie ya había terminado previamente
      if (this.cs2LifecycleService.debeApagarServidor(matchid)) {
        console.log(`[Webhook] La serie ya terminó y la demo está guardada. Mandando 'quit' vía RCON al puerto ${gamePort}...`);
        
        // Le damos un delay ínfimo de 1 segundo para asegurarnos de que el hilo de MatchZy
        // complete el ciclo de cerrado del archivo antes de desconectarse
        setTimeout(async () => {
          await this.rconService.executeCommand('quit', gamePort);
        }, 1000);
      } else {
        console.log(`[Webhook] Se guardó la demo, pero falta resolver mapa o serie. El servidor se mantiene vivo.`);
      }
    }
    
    return { received: true };
  }

  /**
   * ENDPOINT 4: El servidor de CS2 avisa que ya cargó el mapa y el plugin está activo
   */
  @Post('server-ready')
  @HttpCode(HttpStatus.OK)
  async handleServerReady(@Body() body: { matchId: string; port: number }) {
    this.logger.log(`[Webhook] ¡El servidor de CS2 en el puerto ${body.port} avisó que está LISTO!`);
    
    // Disparar la inyección de RCON de forma inmediata, sin esperar ningún timeout fijo
    // Ejecutamos la lógica que antes estaba en el setTimeout
    this.cs2LifecycleService.ejecutarInyeccionMatchZy(body.matchId, body.port);
    
    return { status: 'acknowledged' };
  }
}