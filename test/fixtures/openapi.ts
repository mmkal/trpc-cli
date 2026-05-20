import type {OpenApiDocument} from '../../src/index.js'

export const petstoreOpenApi = {
  openapi: '3.0.3',
  info: {
    title: 'OpenAPI proxify fixture',
    version: '1.0.0',
  },
  paths: {
    '/pets/{petId}': {
      get: {
        operationId: 'getPet',
        summary: 'Get a pet',
        parameters: [
          {
            name: 'petId',
            in: 'path',
            required: true,
            description: 'Pet id',
            schema: {type: 'string'},
          },
          {
            name: 'include',
            in: 'query',
            description: 'Optional expansions',
            schema: {type: 'array', items: {type: 'string'}},
          },
          {
            name: 'x-client-id',
            in: 'header',
            description: 'Client id header',
            schema: {type: 'string'},
          },
        ],
        responses: {
          '200': {description: 'Pet found'},
          '404': {description: 'Pet missing'},
        },
      },
    },
    '/pets': {
      post: {
        operationId: 'createPet',
        summary: 'Create a pet',
        requestBody: {
          required: true,
          description: 'Pet creation payload',
          content: {
            'application/json': {
              schema: {$ref: '#/components/schemas/CreatePet'},
            },
          },
        },
        responses: {
          '201': {description: 'Pet created'},
        },
      },
    },
  },
  components: {
    schemas: {
      CreatePet: {
        type: 'object',
        required: ['name'],
        properties: {
          name: {type: 'string'},
          age: {type: 'integer'},
        },
      },
    },
  },
} satisfies OpenApiDocument
