// src/cs2/cs2.controller.ts
import { Controller, Post, Body } from '@nestjs/common';
import { Cs2RconService } from '../services/cs2.rcon.service';

@Controller('cs2')
export class Cs2Controller {
  constructor(private readonly rconService: Cs2RconService) {}

  //Poder escribir comandos, como si estuviéramos escribiendo en el cmd del server.
  @Post('cmd')
  async sendCustomCommand(@Body('command') command: string) {
    const result = await this.rconService.executeCommand(command);
    return { success: true, output: result };
  }

  //Este endpoint recibe eventos en tiempo real de Matchzy (round_ended, por ejemplo).
  @Post('events')
  async receiveMatchEvent() {
    
  }

  /*
    RECEPCIÓN DE DATOS AL FINALIZAR UN MAPA: STATS & DEMO
  */

  //STATS: Este endpoint recibe un JSON completo de Matchzy con muchos datos, cada vez que se termina un mapa.
  @Post('report')
  async receiveMatchReport() {

  }
  
  //DEMO: Recibir la demo de un mapa, cuando este se termina.
  @Post('demos/upload')
  async receiveDemo() {

  }

}