//ARCHIVO: cs2.module.ts

import { Module } from '@nestjs/common';
import { Cs2Controller } from './controllers/cs2.rcon.controller';
import { Cs2RconService } from './services/cs2.rcon.service';

@Module({
  controllers: [Cs2Controller],
  providers: [Cs2RconService],
  exports: [                    // Por si otro módulo necesita usar RCON
    Cs2RconService
    ], 
})
export class Cs2Module {}