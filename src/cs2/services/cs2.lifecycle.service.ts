import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process'; 
import { Cs2RconService } from './cs2.rcon.service';

@Injectable()
export class Cs2LifecycleService {
  private readonly logger = new Logger(Cs2LifecycleService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly rconService: Cs2RconService,
  ) {}


  /*
    CIERRE DE SERVIDOR
  */
  // Guardamos en memoria los matchid que ya enviaron el evento de cierre de serie
  private seriesFinalizadas = new Set<number>();

  /**
   * Registra que la serie llegó a su fin (ej: el 2-0 del BO3)
   */
  marcarSerieTerminada(matchId: number): void {
    this.seriesFinalizadas.add(matchId);
    this.logger.log(`[Lifecycle] MatchID ${matchId} anotado como SERIE_FINALIZADA. Esperando detención de la demo...`);
  }

  /**
   * Revisa si la serie ya había terminado. Si es así, limpia la memoria y da luz verde para apagar.
   */
  debeApagarServidor(matchId: number): boolean {
    if (this.seriesFinalizadas.has(matchId)) {
      this.seriesFinalizadas.delete(matchId); // Limpiamos memoria
      return true;
    }
    return false;
  }



  /**
   * Genera el JSON de configuración en la carpeta cfg del servidor de CS2 y levanta el ejecutable dedicado
   */
  async generarConfiguracionYPlantar(matchId: string, configuracionData: any, gamePort: number): Promise<void> {
    try {
      const serverRootDir = this.configService.get<string>('CS2_SERVER_ROOT_DIR')!;
      const fileName = `match_${matchId}.json`;
      
      // Normalizamos la ruta del .env para que Windows no reniegue con las barras
      const normalizedRootDir = path.normalize(serverRootDir);

      // Intentamos guardarlo en game/csgo/cfg/MatchZy por orden, si no existe la carpeta, en cfg/
      let targetDir = path.join(normalizedRootDir, 'game', 'csgo', 'cfg', 'MatchZy');
      if (!fs.existsSync(targetDir)) {
        targetDir = path.join(normalizedRootDir, 'game', 'csgo', 'cfg');
      }

      const filePath = path.join(targetDir, fileName);

      // Guardar archivo en disco de forma síncrona
      fs.writeFileSync(filePath, JSON.stringify(configuracionData, null, 2), 'utf-8');
      this.logger.log(`[+] Archivo de configuración ${fileName} generado con éxito.`);

      // ---------------------------------------------------------------------------------
      // LÓGICA DE EJECUCIÓN PARA WINDOWS (D:\\...)
      // ---------------------------------------------------------------------------------
      this.logger.log(`[+] Lanzando CS2 Dedicado en puerto ${gamePort}...`);
      
      const executablePath = path.join(normalizedRootDir, 'game', 'bin', 'win64', 'cs2.exe');
      const rconPassword = this.configService.get<string>('CS2_RCON_PASSWORD')!;
      const tvPort = gamePort + 1000; // Puerto para la GOTV / Espectadores con delay

      // Argumentos nativos separados en un array para que Node no reniegue con las comillas dobles
      const args = [
        '-dedicated',
        '-usercon',
        '-console',
        '-secure',
        '+game_type', '0',
        '+game_mode', '1',
        '+map', 'de_mirage',
        '+ip', '0.0.0.0',
        '-port', gamePort.toString(),
        '+tv_port', tvPort.toString(),
        '+rcon_password', rconPassword,
        '+tv_enable', '1'
      ];

      this.logger.log(`[Proceso CS2] Ejecutando: ${executablePath} con argumentos: ${args.join(' ')}`);

      // Usamos cmd.exe /c start para levantar el server en una ventana de comandos propia e independiente
      const cs2Process = spawn('cmd.exe', ['/c', 'start', '""', executablePath, ...args], {
        detached: true,
        stdio: 'ignore',
      });

      // Cortamos el cordón umbilical con el backend para que corra 100% en background libre
      cs2Process.unref();

      // ---------------------------------------------------------------------------------
      // GATILLO REACTIVO: Iniciamos el polling dinámico en lugar del setTimeout fijo
      // ---------------------------------------------------------------------------------
      this.iniciarPollingRcon(matchId, gamePort);

    } catch (error) {
      this.logger.error(`[-] Error al generar configuración o levantar el servidor: ${error}`);
      throw error;
    }
  }

  /**
   * Devuelve el contenido del JSON generado para el endpoint estático
   */
  obtenerConfiguracionLocal(matchId: string): any {
    const serverRootDir = this.configService.get<string>('CS2_SERVER_ROOT_DIR')!;
    const fileName = `match_${matchId}.json`;
    const normalizedRootDir = path.normalize(serverRootDir);
    
    let filePath = path.join(normalizedRootDir, 'game', 'csgo', 'cfg', 'MatchZy', fileName);
    if (!fs.existsSync(filePath)) {
      filePath = path.join(normalizedRootDir, 'game', 'csgo', 'cfg', fileName);
    }

    if (!fs.existsSync(filePath)) {
      return null;
    }

    const rawData = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(rawData);
  }

  /**
   * Interroga al servidor cada 2 segundos. Apenas responde, ejecuta la inyección.
   */
  private iniciarPollingRcon(matchId: string, gamePort: number): void {
    this.logger.log(`[Polling RCON] Esperando de forma activa que el puerto ${gamePort} esté listo...`);
    let intentos = 0;
    const maxIntentos = 30; // 30 intentos * 2s = 1 minuto de tiempo de espera máximo por si se cuelga

    const interval = setInterval(async () => {
      intentos++;
      try {
        // Ejecutamos un comando básico e inocuo para ver si el socket RCON ya responde
        const respuesta = await this.rconService.executeCommand('echo ping_backend', gamePort);
        
        // Si hay respuesta válida y no contiene el string de error controlado de tu RconService
        if (respuesta && !respuesta.includes('Error de conexión RCON')) {
          this.logger.log(`[Polling RCON] ¡Servidor detectado VIVO en el intento nº ${intentos}! (Tardó aprox ${intentos * 2}s)`);
          clearInterval(interval);
          
          // Ejecutamos la configuración de MatchZy inmediatamente
          await this.ejecutarInyeccionMatchZy(matchId, gamePort);
        }
      } catch (error) {
        // Las caídas por ECONNREFUSED entran acá mientras el server carga. Las ignoramos.
      }

      if (intentos >= maxIntentos) {
        this.logger.error(`[Polling RCON] El servidor de CS2 en el puerto ${gamePort} superó el tiempo límite de carga.`);
        clearInterval(interval);
      }
    }, 2000); // Frecuencia de muestreo: 2 segundos
  }

  /**
   * Inyecta las directivas de MatchZy y el webhook de tracking una vez que el servidor está online
   */
  async ejecutarInyeccionMatchZy(matchId: string, gamePort: number): Promise<void> {
    try {
      const backendUrl = this.configService.get<string>('BACKEND_WEBHOOK_URL')!; 
      const secretToken = this.configService.get<string>('MATCHZY_WEBHOOK_TOKEN')!;

      this.logger.log(`[RCON Inyección] Conectando a MatchZy para estructurar la serie...`);

      // 1. Configurar URL de Webhooks para capturar eventos en tiempo real
      const webhooksUrl = `${backendUrl}/cs2/events`;
      this.logger.log(`[RCON Inyección] Configurando URL de Webhooks: ${webhooksUrl}`);
      await this.rconService.executeCommand(`mp_backup_round_file_pattern "MatchZyDataBackup\\Valve\\${matchId}\\matchbackup"`, gamePort);

      // 1.5 - LIMPIEZA DE RAÍZ: Desviar los backups nativos de Valve a la carpeta de MatchZy
      // Usamos barras invertidas escapadas para Windows, indicando que guarde dentro de MatchZyDataBackup
      this.logger.log(`[RCON Inyección] Desviando backups nativos de Valve para limpiar la raíz...`);
      await this.rconService.executeCommand(`mp_backup_round_file_pattern "MatchZyDataBackup\\matchbackup_${matchId}"`, gamePort);
      // 2. Inyectar Headers de seguridad obligatorios
      await this.rconService.executeCommand(`matchzy_remote_log_header_key "Authorization"`, gamePort);
      await this.rconService.executeCommand(`matchzy_remote_log_header_value "Bearer ${secretToken}"`, gamePort);

      // 3. Comando clave para chupar la config desde tu endpoint de NestJS
      const configUrl = `${backendUrl}/cs2/config/${matchId}`;
      const loadMatchCommand = `matchzy_loadmatch_url "${configUrl}"`;
      
      this.logger.log(`[RCON Inyección] Ejecutando comando de carga: ${loadMatchCommand}`);
      const response = await this.rconService.executeCommand(loadMatchCommand, gamePort);
      this.logger.log(`[RCON Inyección] MatchZy respondió: ${response || 'OK (Silencioso)'}`);

    } catch (error) {
      this.logger.error(`[-] Error crítico en la inicialización por RCON: ${error}`);
    }
  }
}