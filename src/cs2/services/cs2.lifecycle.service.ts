import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process'; // <-- Cambiamos exec por spawn para mejor manejo en Windows
import { Cs2RconService } from './cs2.rcon.service';

@Injectable()
export class Cs2LifecycleService {
  private readonly logger = new Logger(Cs2LifecycleService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly rconService: Cs2RconService,
  ) {}

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
      // LÓGICA CORREGIDA DE EJECUCIÓN PARA WINDOWS (D:\\...)
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
      // De esta forma, si el backend se reinicia, el server de CS2 se queda prendido y no se muere
      const cs2Process = spawn('cmd.exe', ['/c', 'start', '""', executablePath, ...args], {
        detached: true,
        stdio: 'ignore',
      });

      // Cortamos el cordón umbilical con el backend para que corra 100% en background libre
      cs2Process.unref();

      // ---------------------------------------------------------------------------------

      // Disparar la inyección automatizada por RCON
      this.iniciarAutostartRcon(matchId, gamePort);

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
   * Maneja el delay y la ejecución secuencial de comandos RCON exigidos por MatchZy Enhanced
   */
  private iniciarAutostartRcon(matchId: string, gamePort: number): void {
    // Le damos 30 segundos de gracia. El servidor de CS2 en local suele tardar unos 15 segundos en cargar
    const tiempoEsperaMs = 30000; 
    this.logger.log(`[...] Esperando ${tiempoEsperaMs / 1000} segundos a que el mapa cargue por completo...`);
    
    setTimeout(async () => {
      try {
        const backendUrl = this.configService.get<string>('BACKEND_WEBHOOK_URL')!; 
        const secretToken = this.configService.get<string>('MATCHZY_WEBHOOK_TOKEN')!;

        this.logger.log(`[RCON Autostart] Conectando a MatchZy para inyectar configuración...`);

        // 1. Configurar URL de Webhooks para capturar eventos en tiempo real
        const webhooksUrl = `${backendUrl}/cs2/events`;
        this.logger.log(`[RCON Autostart] Configurando URL de Webhooks: ${webhooksUrl}`);
        await this.rconService.executeCommand(`matchzy_remote_log_url "${webhooksUrl}"`, gamePort);

        // 2. Inyectar Headers de seguridad obligatorios (Usa el token largo del .env)
        await this.rconService.executeCommand(`matchzy_remote_log_header_key "Authorization"`, gamePort);
        await this.rconService.executeCommand(`matchzy_remote_log_header_value "Bearer ${secretToken}"`, gamePort);

        // 3. Comando clave para chupar la config desde tu endpoint de NestJS
        const configUrl = `${backendUrl}/cs2/config/${matchId}`;
        const loadMatchCommand = `matchzy_loadmatch_url "${configUrl}"`;
        
        this.logger.log(`[RCON Autostart] Ejecutando comando de carga: ${loadMatchCommand}`);
        const response = await this.rconService.executeCommand(loadMatchCommand, gamePort);
        this.logger.log(`[RCON Autostart] MatchZy respondió: ${response || 'OK (Silencioso)'}`);

        // Forzar el apagado del servidor dedicado al finalizar la serie (BO1, BO3, BO5)
        this.logger.log(`[RCON Autostart] Configurando auto-apagado del servidor al terminar la serie...`);
        await this.rconService.executeCommand(`matchzy_series_end_command "quit"`, gamePort);

      } catch (rconError) {
        this.logger.error(`[-] Error en la inicialización por RCON: ${rconError}`);
      }
    }, tiempoEsperaMs);
  }
}