import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  UnprocessableEntityException,
} from '@nestjs/common';
import { z } from 'zod';
import { BillersPort } from '../core/recaudos.port.js';
import { safeRegex } from './safe-regex.js';

const BillerId = z.string().regex(/^blr-\d{3}$/);
const ListQuery = z.strictObject({
  category: z
    .string()
    .regex(/^[a-z]{2,20}$/)
    .optional(),
  q: z
    .string()
    .max(40)
    .regex(/^[\p{L}\p{N} ]*$/u)
    .optional(),
});
const DebtsBody = z.strictObject({
  reference: z
    .string()
    .min(4)
    .max(20)
    .regex(/^[A-Za-z0-9]+$/),
});

@Controller('v1')
export class BillersController {
  constructor(private readonly billers: BillersPort) {}

  @Get('categories')
  categories() {
    return this.billers.categories().then((items) => ({ items }));
  }

  @Get('billers')
  async list(@Query({ schema: ListQuery }) query: z.infer<typeof ListQuery>) {
    const items = await this.billers.billers({ categoryId: query.category, q: query.q });
    return { items };
  }

  @Get('billers/:id')
  async get(@Param('id', { schema: BillerId }) id: string) {
    const b = await this.billers.biller(id);
    if (!b) throw new NotFoundException();
    return b;
  }

  /** POST para que la referencia (dato del cliente) no quede en logs de URL. */
  @Post('billers/:id/debts')
  @HttpCode(200)
  async debts(
    @Param('id', { schema: BillerId }) id: string,
    @Body({ schema: DebtsBody }) body: z.infer<typeof DebtsBody>,
  ) {
    const b = await this.billers.biller(id);
    if (!b) throw new NotFoundException();
    if (!safeRegex(b.referencePattern).test(body.reference)) {
      throw new UnprocessableEntityException(`${b.referenceLabel} inválido`);
    }
    return { biller: { id: b.id, name: b.name }, items: await this.billers.debts(id, body.reference) };
  }
}
