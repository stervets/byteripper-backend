// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { CliService } from './cli/cli.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const cli = app.get(CliService);
  const argv = process.argv.slice(2);

  try {
    await cli.run(argv);
  } catch (e) {
    console.error('CLI error:', e);
  } finally {
    await app.close();
  }
}

bootstrap();

/*
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
*/