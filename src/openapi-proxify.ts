import type {JSONSchema7, JSONSchema7Definition} from 'json-schema'
import type {NorpcRouterLike} from './parse-router.js'
import type {StandardSchemaV1} from './standard-schema/contract.js'
import type {TrpcCliMeta} from './types.js'

const openApiHttpMethods = ['delete', 'get', 'head', 'options', 'patch', 'post', 'put', 'trace'] as const

type OpenApiHttpMethod = (typeof openApiHttpMethods)[number]

type OpenApiReference = {
  $ref: string
}

export type OpenApiSchemaObject = JSONSchema7 & {
  nullable?: boolean
}

export type OpenApiParameterObject = {
  name: string
  in: 'path' | 'query' | 'header' | 'cookie'
  description?: string
  required?: boolean
  schema?: OpenApiSchemaObject | OpenApiReference
}

export type OpenApiRequestBodyObject = {
  description?: string
  required?: boolean
  content?: Record<string, {schema?: OpenApiSchemaObject | OpenApiReference}>
}

export type OpenApiOperationObject = {
  operationId?: string
  summary?: string
  description?: string
  parameters?: Array<OpenApiParameterObject | OpenApiReference>
  requestBody?: OpenApiRequestBodyObject | OpenApiReference
  responses?: Record<string, unknown>
}

export type OpenApiPathItemObject = {
  parameters?: Array<OpenApiParameterObject | OpenApiReference>
} & Partial<Record<OpenApiHttpMethod, OpenApiOperationObject>>

export type OpenApiDocument = {
  openapi: string
  info?: {
    title?: string
    version?: string
    description?: string
  }
  servers?: Array<{url: string}>
  paths: Record<string, OpenApiPathItemObject | undefined>
  components?: {
    schemas?: Record<string, OpenApiSchemaObject>
    parameters?: Record<string, OpenApiParameterObject>
    requestBodies?: Record<string, OpenApiRequestBodyObject>
  }
}

export type OpenApiProxifyOperation = {
  name: string
  method: OpenApiHttpMethod
  path: string
  operation: OpenApiOperationObject
}

export type OpenApiHeadersInit = Record<string, string> | Array<[string, string]> | Headers

export type OpenApiProxifyParams = {
  document: OpenApiDocument
  baseUrl: string
  headers?:
    | OpenApiHeadersInit
    | ((
        operation: OpenApiProxifyOperation,
        input: Record<string, unknown>,
      ) => OpenApiHeadersInit | Promise<OpenApiHeadersInit>)
  fetch?: typeof globalThis.fetch
}

type OpenApiInputField = {
  source: 'path' | 'query' | 'header' | 'body'
  name: string
  key: string
  required: boolean
  schema: JSONSchema7
}

type OpenApiProcedure = OpenApiProxifyOperation & {
  inputFields: OpenApiInputField[]
}

type JsonSchemaStandardSchema = StandardSchemaV1<Record<string, unknown>> & {
  toJsonSchema: () => JSONSchema7
}

export class OpenApiProxifyHttpError extends Error {
  status: number
  statusText: string
  method: string
  url: string
  body: unknown

  constructor(params: {status: number; statusText: string; method: string; url: string; body: unknown}) {
    const bodySuffix =
      params.body == null ? '' : `: ${typeof params.body === 'string' ? params.body : JSON.stringify(params.body)}`
    super(`${params.method.toUpperCase()} ${params.url} failed with ${params.status} ${params.statusText}${bodySuffix}`)
    this.name = 'OpenApiProxifyHttpError'
    this.status = params.status
    this.statusText = params.statusText
    this.method = params.method
    this.url = params.url
    this.body = params.body
  }
}

/**
 * @experimental Runtime OpenAPI-to-CLI prototype.
 *
 * Limitations in this first pass:
 * - accepts already-loaded OpenAPI 3.x JSON objects only; YAML, remote loading, and remote refs are caller-owned
 * - resolves local `#/...` refs only
 * - supports path, query, and header parameters plus `application/json` request bodies
 * - serializes query arrays as repeated keys and path parameters with simple URL encoding
 * - does not validate responses or implement full OpenAPI schema semantics such as discriminators
 */
export const openapiProxify = (params: OpenApiProxifyParams): NorpcRouterLike => {
  assertOpenApi3(params.document)

  const router: NorpcRouterLike = {}
  const operationNames = new Set<string>()

  for (const procedure of parseOpenApiProcedures(params.document, operationNames)) {
    const inputSchema = createInputSchema(procedure)
    assignProcedure(router, procedure.name, {
      type: 'norpc',
      input: inputSchema,
      meta: createProcedureMeta(procedure),
      fn: ({input}) => callOpenApiProcedure(params, procedure, input as Record<string, unknown>),
      call: async input => {
        const parsed = await inputSchema['~standard'].validate(input)
        if ('issues' in parsed && parsed.issues) {
          throw new Error(`Invalid input: ${parsed.issues.map(issue => issue.message).join(', ')}`)
        }
        return callOpenApiProcedure(params, procedure, parsed.value)
      },
    })
  }

  return router
}

const assertOpenApi3 = (document: OpenApiDocument) => {
  if (!document || typeof document !== 'object') {
    throw new Error(`Expected an OpenAPI document object`)
  }
  if (!document.openapi || !document.openapi.startsWith('3.')) {
    throw new Error(`openapiProxify currently supports OpenAPI 3.x documents only`)
  }
  if (!document.paths || typeof document.paths !== 'object') {
    throw new Error(`OpenAPI document is missing a paths object`)
  }
}

const parseOpenApiProcedures = (document: OpenApiDocument, operationNames: Set<string>): OpenApiProcedure[] => {
  const procedures: OpenApiProcedure[] = []
  for (const [path, pathItem] of Object.entries(document.paths)) {
    if (!pathItem) continue

    for (const method of openApiHttpMethods) {
      const operation = pathItem[method]
      if (!operation) continue

      const name = uniqueOperationName(operationNames, operation.operationId || operationNameFromPath(method, path))
      procedures.push({
        name,
        method,
        path,
        operation,
        inputFields: getInputFields(document, pathItem, operation),
      })
    }
  }
  return procedures
}

const createInputSchema = (procedure: OpenApiProcedure): JsonSchemaStandardSchema => {
  const required = procedure.inputFields.filter(field => field.required).map(field => field.key)
  const properties = Object.fromEntries(procedure.inputFields.map(field => [field.key, field.schema])) as Record<
    string,
    JSONSchema7
  >
  const jsonSchema: JSONSchema7 = {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  }

  return {
    '~standard': {
      version: 1,
      vendor: 'trpc-cli-openapi',
      validate: value => validateTopLevelInput(jsonSchema, value),
    },
    toJsonSchema: () => jsonSchema,
  }
}

const createProcedureMeta = (procedure: OpenApiProcedure): TrpcCliMeta => {
  const description = [procedure.operation.summary, procedure.operation.description].filter(Boolean).join('\n\n')
  return {description}
}

const validateTopLevelInput = (
  schema: JSONSchema7,
  value: unknown,
): StandardSchemaV1.Result<Record<string, unknown>> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {issues: [{message: `Expected object input`}]}
  }

  const input = value as Record<string, unknown>
  const required = schema.required || []
  const missing = required.filter(key => input[key] === undefined)
  if (missing.length) {
    return {issues: missing.map(key => ({message: `Missing required input: ${key}`, path: [key]}))}
  }

  return {value: input}
}

const getInputFields = (
  document: OpenApiDocument,
  pathItem: OpenApiPathItemObject,
  operation: OpenApiOperationObject,
): OpenApiInputField[] => {
  const fields: OpenApiInputField[] = []
  const usedKeys = new Set<string>()
  const hasBody = !!operation.requestBody

  for (const parameter of getMergedParameters(document, pathItem, operation)) {
    if (parameter.in === 'cookie') continue
    const fallbackKey = propertyKeyFromParameter(parameter.name)
    const key = reserveInputKey(usedKeys, fallbackKey === 'body' && hasBody ? `${parameter.in}Body` : fallbackKey)
    const parameterSchema = parameter.schema
      ? normalizeOpenApiSchema(parameter.schema, document)
      : ({type: 'string'} as JSONSchema7)
    fields.push({
      source: parameter.in,
      name: parameter.name,
      key,
      required: parameter.required || parameter.in === 'path',
      schema: {...parameterSchema, description: parameter.description || parameterSchema.description},
    })
  }

  if (operation.requestBody) {
    const requestBody = resolveRef<OpenApiRequestBodyObject>(operation.requestBody, document)
    const content = requestBody.content || {}
    if (!getJsonContent(content)) {
      throw new Error(
        `Unsupported request body for ${operation.operationId || 'unnamed OpenAPI operation'}: only application/json request bodies are supported`,
      )
    }
    const jsonContent = getJsonContent(content)
    const bodySchema = jsonContent?.schema ? normalizeOpenApiSchema(jsonContent.schema, document) : {}
    fields.push({
      source: 'body',
      name: 'body',
      key: reserveInputKey(usedKeys, 'body'),
      required: requestBody.required === true,
      schema: {...bodySchema, description: requestBody.description || bodySchema.description || 'JSON request body'},
    })
  }

  return fields
}

const getMergedParameters = (
  document: OpenApiDocument,
  pathItem: OpenApiPathItemObject,
  operation: OpenApiOperationObject,
): OpenApiParameterObject[] => {
  const entries = [...(pathItem.parameters || []), ...(operation.parameters || [])]
    .map(parameter => resolveRef<OpenApiParameterObject>(parameter, document))
    .map(parameter => ({...parameter, required: parameter.required || parameter.in === 'path'}))

  return [...new Map(entries.map(parameter => [`${parameter.in}:${parameter.name}`, parameter])).values()]
}

const getJsonContent = (content: OpenApiRequestBodyObject['content']) => {
  if (!content) return null
  const jsonContentType = Object.keys(content).find(contentType => {
    const [mimeType] = contentType.toLowerCase().split(';')
    return mimeType === 'application/json' || mimeType.endsWith('+json')
  })
  return jsonContentType ? content[jsonContentType] : null
}

const callOpenApiProcedure = async (
  params: OpenApiProxifyParams,
  procedure: OpenApiProcedure,
  input: Record<string, unknown>,
) => {
  const fetchFn = params.fetch || globalThis.fetch
  if (!fetchFn) throw new Error(`openapiProxify requires a fetch implementation`)

  const requestUrl = buildRequestUrl(params.baseUrl, procedure, input)
  const headers = new Headers(await getHeaders(params, procedure, input))
  applyHeaderParams(headers, procedure, input)
  const body = getRequestBody(procedure, input)

  if (body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }

  const response = await fetchFn(requestUrl, {
    method: procedure.method.toUpperCase(),
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const responseBody = await parseResponseBody(response)

  if (!response.ok) {
    throw new OpenApiProxifyHttpError({
      status: response.status,
      statusText: response.statusText,
      method: procedure.method,
      url: requestUrl,
      body: responseBody,
    })
  }

  return responseBody
}

const getHeaders = async (
  params: OpenApiProxifyParams,
  procedure: OpenApiProcedure,
  input: Record<string, unknown>,
): Promise<OpenApiHeadersInit> => {
  if (typeof params.headers === 'function') return params.headers(procedure, input)
  return params.headers || {}
}

const applyHeaderParams = (headers: Headers, procedure: OpenApiProcedure, input: Record<string, unknown>) => {
  for (const field of procedure.inputFields.filter(inputField => inputField.source === 'header')) {
    const value = input[field.key]
    if (value === undefined || value === null) continue
    headers.set(field.name, stringifyPrimitive(value, `header parameter ${field.name}`))
  }
}

const buildRequestUrl = (baseUrl: string, procedure: OpenApiProcedure, input: Record<string, unknown>) => {
  const url = new URL(baseUrl)
  url.pathname = joinUrlPath(url.pathname, applyPathParams(procedure, input))

  for (const field of procedure.inputFields.filter(inputField => inputField.source === 'query')) {
    const value = input[field.key]
    if (value === undefined) continue
    appendQueryValue(url.searchParams, field.name, value)
  }

  return url.toString()
}

const applyPathParams = (procedure: OpenApiProcedure, input: Record<string, unknown>) => {
  let path = procedure.path
  for (const field of procedure.inputFields.filter(inputField => inputField.source === 'path')) {
    const value = input[field.key]
    if (value === undefined) throw new Error(`Missing path parameter: ${field.name}`)
    path = path.replaceAll(
      `{${field.name}}`,
      encodeURIComponent(stringifyPrimitive(value, `path parameter ${field.name}`)),
    )
  }
  return path
}

const getRequestBody = (procedure: OpenApiProcedure, input: Record<string, unknown>) => {
  for (const field of procedure.inputFields) {
    if (field.source === 'body') return input[field.key]
  }
  return undefined
}

const appendQueryValue = (searchParams: URLSearchParams, name: string, value: unknown) => {
  if (Array.isArray(value)) {
    value.forEach(item => appendQueryValue(searchParams, name, item))
    return
  }
  if (value === null || value === undefined) return
  searchParams.append(name, stringifyPrimitive(value, `query parameter ${name}`))
}

const stringifyPrimitive = (value: unknown, label: string) => {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value)
  }
  throw new Error(`Only primitive values are supported for ${label}`)
}

const parseResponseBody = async (response: Response) => {
  if (response.status === 204) return null
  const text = await response.text()
  if (!text) return null
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json') || contentType.includes('+json')) {
    return JSON.parse(text) as unknown
  }
  return text
}

const joinUrlPath = (basePath: string, operationPath: string) => {
  const trimmedBasePath = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath
  const normalizedOperationPath = operationPath.startsWith('/') ? operationPath : `/${operationPath}`
  return `${trimmedBasePath}${normalizedOperationPath}` || '/'
}

const assignProcedure = (router: NorpcRouterLike, name: string, procedure: NorpcRouterLike[string]) => {
  if (name.includes('.')) throw new Error(`OpenAPI operation names cannot contain dots after normalization: ${name}`)
  router[name] = procedure
}

const uniqueOperationName = (operationNames: Set<string>, name: string) => {
  const normalized = normalizeName(name)
  const baseName = normalized || 'operation'
  let candidate = baseName
  let suffix = 2
  while (operationNames.has(candidate)) {
    candidate = `${baseName}${suffix}`
    suffix += 1
  }
  operationNames.add(candidate)
  return candidate
}

const operationNameFromPath = (method: OpenApiHttpMethod, path: string) => {
  const words = path
    .split('/')
    .filter(Boolean)
    .flatMap(segment => {
      const match = segment.match(/^\{(.+)\}$/)
      if (match) return ['by', match[1]]
      return wordsFromString(segment)
    })
  return [method, ...words].join(' ')
}

const normalizeName = (name: string) => {
  const words = wordsFromString(name)
  return words.map((word, index) => (index === 0 ? word : capitalise(word))).join('')
}

const propertyKeyFromParameter = (name: string) => normalizeName(name) || 'value'

const reserveInputKey = (usedKeys: Set<string>, requestedKey: string) => {
  let key = requestedKey
  let suffix = 2
  while (usedKeys.has(key)) {
    key = `${requestedKey}${suffix}`
    suffix += 1
  }
  usedKeys.add(key)
  return key
}

const wordsFromString = (value: string) => {
  return value
    .replaceAll(/([a-z\d])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(word => word.toLowerCase())
}

const capitalise = (value: string) => value.slice(0, 1).toUpperCase() + value.slice(1)

const normalizeOpenApiSchema = (
  schemaOrRef: OpenApiSchemaObject | OpenApiReference | JSONSchema7Definition,
  document: OpenApiDocument | OpenApiOperationObject,
  seenRefs: string[] = [],
): JSONSchema7 => {
  if (!schemaOrRef || typeof schemaOrRef !== 'object') return {}

  const schema = resolveRef<OpenApiSchemaObject>(schemaOrRef, document, seenRefs)
  const {nullable, properties, items, allOf, anyOf, oneOf, ...rest} = schema
  const normalized: JSONSchema7 = {...rest}

  if (properties) {
    normalized.properties = Object.fromEntries(
      Object.entries(properties).map(([key, value]) => [key, normalizeOpenApiSchema(value, document, seenRefs)]),
    )
  }
  if (items && typeof items === 'object' && !Array.isArray(items)) {
    normalized.items = normalizeOpenApiSchema(items, document, seenRefs)
  }
  if (allOf) normalized.allOf = allOf.map(value => normalizeOpenApiSchema(value, document, seenRefs))
  if (anyOf) normalized.anyOf = anyOf.map(value => normalizeOpenApiSchema(value, document, seenRefs))
  if (oneOf) normalized.oneOf = oneOf.map(value => normalizeOpenApiSchema(value, document, seenRefs))
  if (nullable && typeof normalized.type === 'string') normalized.type = [normalized.type, 'null']

  return normalized
}

function resolveRef<T>(
  value: T | OpenApiReference | undefined,
  document: OpenApiDocument | OpenApiOperationObject,
  seenRefs: string[] = [],
): T {
  if (!value || typeof value !== 'object' || !('$ref' in value)) return value as T
  if (!value.$ref.startsWith('#/')) {
    throw new Error(`Unsupported OpenAPI ref ${value.$ref}; only local refs are supported`)
  }
  if (seenRefs.includes(value.$ref)) {
    throw new Error(`Circular OpenAPI ref detected: ${[...seenRefs, value.$ref].join(' -> ')}`)
  }

  let current: unknown = document
  for (const segment of value.$ref.slice(2).split('/')) {
    const key = segment.replaceAll('~1', '/').replaceAll('~0', '~')
    current = (current as Record<string, unknown>)[key]
    if (current === undefined) throw new Error(`Unable to resolve OpenAPI ref ${value.$ref}`)
  }
  return resolveRef(current as T | OpenApiReference, document, [...seenRefs, value.$ref])
}
