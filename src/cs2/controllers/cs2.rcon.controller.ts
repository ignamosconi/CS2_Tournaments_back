import { Controller, Post, Get, Body, Param, Res, HttpStatus, HttpCode, Headers, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { Cs2LifecycleService } from '../services/cs2.lifecycle.service';
import { Cs2RconService } from '../services/cs2.rcon.service';

@Controller('cs2')
export class Cs2Controller {
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
    
    // Acá procesás los datos (Kills, cambios de estado de torneo, etc.)
    console.log('--- [EVENTO RECIBIDO DESDE MATCHZY] ---');
    console.log(JSON.stringify(eventData, null, 2));
    
    return { received: true };
  }
}