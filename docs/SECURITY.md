# Seguridad — mse-recaudos

Marco general y pipeline: [`spa-banca-movil/docs/SECURITY.md`](https://github.com/jrocafuerte/spa-banca-movil/blob/main/docs/SECURITY.md).

## Controles de este BFF

| Control | Dónde | Prueba e2e |
|---|---|---|
| Handoff ES256 vía JWKS remoto, `typ=handoff+jwt`, `aud`, `iss`, `maxTokenAge` | `session/trusted-tokens.service.ts` | tipo incorrecto ⇒ 401 |
| `jti` de un solo uso (anti-replay) para handoff y step-up | `trusted-tokens.service.ts` | handoff reutilizado ⇒ 401 |
| Canje solo servidor-a-servidor (`X-Internal-Client-Secret`, comparación en tiempo constante) | `session/session.controller.ts` | — |
| Sesión opaca, almacenada hasheada, TTL deslizante acotado | `session/session.store.ts` | unit |
| Anti-CSRF: header custom + `Origin` permitido | `common/security/session.guard.ts` | 403 sin header / origen ajeno |
| Validación de referencia por convenio, protegida contra ReDoS | `billers/safe-regex.ts` | 422 / unit |
| Step-up ligado a la transacción (`txn`, `amt`, `cur`, `sub`, `sid`) | `payments/payments.service.ts` | monto alterado ⇒ 403 |
| Intent de un solo uso con expiración (5 min) | `payments.service.ts` | — |
| Idempotencia en `POST /v1/payments` | `common/idempotency` | — |
| BOLA en comprobantes | `payments.service.ts` | 404 |
| Sin CORS (no es invocado por navegadores) | `main.ts` | — |

## DAST autenticado (QA)

El escaneo autenticado de extremo a extremo requiere un *handoff token* real; se ejecuta en el ambiente de integración con un usuario sintético: login en `mse-banca-movil` → `POST /v1/microfrontends/recaudos/handoff` → `POST /v1/session/exchange` → ZAP con `X-Recaudos-Session` vía *replacer* (mismo patrón que `mse-banca-movil/.github/workflows/dast.yml`).
