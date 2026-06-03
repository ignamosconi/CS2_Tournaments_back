// src/cs2/cs2.rcon.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Rcon } from 'rcon-client';

@Injectable()
export class Cs2RconService {
  private readonly logger = new Logger(Cs2RconService.name);

  constructor(private configService: ConfigService) {}

  /**
   * Ejecuta un comando vía RCON de manera dinámica.
   * @param command El comando de consola de CS2 a ejecutar (ej: "mp_restartgame 1")
   * @param customPort Puerto opcional por si necesitás pegarle al Server 2 (27016, etc.)
   */
  async executeCommand(command: string, customPort?: number): Promise<string> {
    const host = this.configService.get<string>('CS2_RCON_HOST') || '127.0.0.1';
    const password = this.configService.get<string>('CS2_RCON_PASSWORD')!;
    // Si pasás un puerto por parámetro usa ese, si no, busca el del .env, y por último el 27015 por defecto
    const port = customPort || this.configService.get<number>('CS2_RCON_PORT') || 27015;

    let rconClient: Rcon | null = null;

    try {
      this.logger.log(`[RCON] Intentando conectar a ${host}:${port}...`);
      
      // Conexión "Lazy" (bajo demanda)
      rconClient = await Rcon.connect({ host, port, password });
      
      this.logger.log(`[RCON] Enviando comando: "${command}"`);
      const response = await rconClient.send(command);
      
      return response;
    } catch (error) {
      this.logger.error(`[RCON] Error al conectar/ejecutar en el puerto ${port}. Log: ${error}`);
      
      // Devolvemos el error de forma controlada para que tu endpoint no rompa NestJS
      return `Error de conexión RCON en puerto ${port}. ¿El servidor de CS2 está apagado? Detalle: ${error}`;
    } finally {
      // El bloque finally se ejecuta SIEMPRE, asegurando que el socket se cierre pase lo que pase
      if (rconClient) {
        await rconClient.end();
        this.logger.log(`[RCON] Conexión cerrada limpiamente para ${host}:${port}`);
      }
    }
  }
}