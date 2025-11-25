// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { EvmService } from './evm/evm.service';
import { ws } from './ws';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const host = '0.0.0.0';
  const port = 9545;
  const server = app.getHttpServer();
  ws.init(server);

  const evmService = app.get(EvmService);
  const argv = process.argv.slice(2);

  try {
    await evmService.run(argv[0]);
  } catch (e) {
    console.error('Evm Service deploy error:', e);
  } finally {
    await app.close();
  }

  await app.listen(port, host);
  console.log(`Listen HTTP: http://${host}:${port}`);
  console.log(`  Listen WS:   ws://${host}:${port}/ws`);
}

bootstrap();
