const customer = { type: 'object', required: ['id', 'name', 'phone', 'email', 'rrn', 'account', 'grade', 'status'], properties: { id: { type: 'string' }, name: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string', format: 'email' }, rrn: { type: 'string' }, account: { type: 'string' }, grade: { type: 'string', enum: ['standard', 'gold', 'vip'] }, status: { type: 'string', enum: ['active', 'inactive', 'suspended'] } } };
const customerRef = { $ref: '#/components/schemas/Customer' };
const response = (schema: unknown) => ({ description: 'Success', content: { 'application/json': { schema } } });
const id = { name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: '^C[0-9]{3}$' } };
export const openapi = {
  openapi: '3.1.0', info: { title: 'Customer management demo', version: '1.0.0', description: 'Synthetic customer data only' },
  security: [{ serviceToken: [] }],
  paths: {
    '/customers': { get: { operationId: 'listCustomers', summary: '고객 목록 조회', parameters: [{ name: 'query', in: 'query', schema: { type: 'string' } }, { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } }, { name: 'size', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } }], responses: { '200': response({ type: 'object', properties: { items: { type: 'array', items: customerRef }, total: { type: 'integer' }, page: { type: 'integer' }, size: { type: 'integer' } } }), '401': { description: 'Service authentication required' } } } },
    '/customers/{id}': {
      get: { operationId: 'getCustomer', summary: '고객 상세 조회', parameters: [id], responses: { '200': response(customerRef), '404': { description: 'Customer not found' } } },
      patch: { operationId: 'updateCustomerStatus', summary: '고객 상태 변경', parameters: [id], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false, required: ['status'], properties: { status: customer.properties.status } } } } }, responses: { '200': response(customerRef), '400': { description: 'Invalid status' }, '404': { description: 'Customer not found' } } },
    },
    '/customers/{id}/orders': { get: { operationId: 'getCustomerOrders', summary: '고객 주문 조회', parameters: [id], responses: { '200': response({ type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, customerId: { type: 'string' }, total: { type: 'integer' }, status: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' } } } } } }), '404': { description: 'Customer not found' } } } },
  },
  components: { schemas: { Customer: customer }, securitySchemes: { serviceToken: { type: 'apiKey', in: 'header', name: 'X-Service-Token' } } },
};
