// src/cs2/cs2.controller.ts
import { Controller, Post, Body } from '@nestjs/common';
import { Cs2RconService } from '../services/cs2.rcon.service';

@Controller('cs2')
export class Cs2Controller {
  constructor(private readonly rconService: Cs2RconService) {}

  @Post('cmd')
  async sendCustomCommand(@Body('command') command: string) {
    const result = await this.rconService.executeCommand(command);
    return { success: true, output: result };
  }

  @Post('start-match')
  async startMatch() {
    await this.rconService.executeCommand(
      'matchzy_loadmatch_url "http://127.0.0.1:3000/match/1"'
    );

    return { message: 'Match cargado correctamente' };
  }
}