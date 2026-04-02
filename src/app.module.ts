import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { Cs2Module } from './cs2/cs2.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (config) => { //Si faltan estas variables, el servidor directamente no arranca.
        if (!config.CS2_RCON_HOST || !config.CS2_RCON_PORT || !config.CS2_RCON_PASSWORD) {
          throw new Error('ERROR: Faltan variables de servidor en .env');
        }
        return config;
      },
    }),
    Cs2Module,
    
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
