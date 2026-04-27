import type { Request, Response, NextFunction } from "express";
import { z, type ZodTypeAny } from "zod";

const requestSchema = z.object({
  body: z.unknown().optional(),
  query: z.unknown().optional(),
  params: z.unknown().optional()
});

type SchemaShape = {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
};

export function validate(schema: SchemaShape) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    requestSchema.parse({ body: req.body, query: req.query, params: req.params });

    if (schema.body) req.body = schema.body.parse(req.body) as any;
    if (schema.query) req.query = schema.query.parse(req.query) as any;
    if (schema.params) req.params = schema.params.parse(req.params) as any;

    next();
  };
}
