import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { createRemoteJWKSet } from 'jose';
import { BillersController } from './billers/billers.controller.js';
import { AllExceptionsFilter } from './common/http/all-exceptions.filter.js';
import { RequestIdMiddleware } from './common/http/request-id.middleware.js';
import { SessionGuard } from './common/security/session.guard.js';
import { ENV, type Env, loadEnv } from './config/env.js';
import { InMemoryAccounts, InMemoryBillers } from './core/in-memory.adapters.js';
import { AccountsPort, BillersPort } from './core/recaudos.port.js';
import { HealthController } from './health/health.controller.js';
import { PaymentsController } from './payments/payments.controller.js';
import { PaymentsService } from './payments/payments.service.js';
import { SessionController } from './session/session.controller.js';
import { SessionStore } from './session/session.store.js';
import { KEY_RESOLVER, TrustedTokensService } from './session/trusted-tokens.service.js';

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }])],
  controllers: [HealthController, SessionController, BillersController, PaymentsController],
  providers: [
    { provide: ENV, useFactory: () => loadEnv() },
    {
      provide: KEY_RESOLVER,
      inject: [ENV],
      // JWKS remoto con caché y cooldown (soporta rotación de claves por `kid`).
      useFactory: (env: Env) =>
        createRemoteJWKSet(new URL(env.TRUSTED_JWKS_URL), { cooldownDuration: 30_000, cacheMaxAge: 600_000 }),
    },
    TrustedTokensService,
    SessionStore,
    PaymentsService,
    InMemoryBillers,
    { provide: BillersPort, useExisting: InMemoryBillers },
    { provide: AccountsPort, useClass: InMemoryAccounts },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*path');
  }
}
