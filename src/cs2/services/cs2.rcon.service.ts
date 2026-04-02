// src/cs2/cs2.rcon.service.ts
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Rcon } from 'rcon-client';

@Injectable()
export class Cs2RconService implements OnModuleDestroy {
  private rcon!: Rcon;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    this.rcon = await Rcon.connect({
      host: this.configService.get<string>('CS2_RCON_HOST')!,
      port: this.configService.get<number>('CS2_RCON_PORT')!,
      password: this.configService.get<string>('CS2_RCON_PASSWORD')!,
    });
  }

  async executeCommand(command: string): Promise<string> {
    return await this.rcon.send(command);
  }

  async onModuleDestroy() {
    if (this.rcon) await this.rcon.end();
  }
}