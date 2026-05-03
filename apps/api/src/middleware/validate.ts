import { z } from "zod";
const requestSchema = z.object({
    body: z.unknown().optional(),
    query: z.unknown().optional(),
    params: z.unknown().optional()
});
export function validate(schema) {
    return (req, _res, next) => {
        requestSchema.parse({ body: req.body, query: req.query, params: req.params });
        if (schema.body)
            req.body = schema.body.parse(req.body);
        if (schema.query) {
            const parsedQuery = schema.query.parse(req.query);
            /** Express 5: `req.query` is a read-only accessor; assignment throws. Shadow with an own data property. */
            Object.defineProperty(req, "query", {
                value: parsedQuery,
                writable: true,
                enumerable: true,
                configurable: true
            });
        }
        if (schema.params)
            req.params = schema.params.parse(req.params);
        next();
    };
}
