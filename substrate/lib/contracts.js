// Loads contracts.schema.json once and validates any object against a named $def.
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { SCHEMA_PATH, readJson } from './paths.js'

let ajv, schema

function load() {
  if (ajv) return
  schema = readJson(SCHEMA_PATH)
  ajv = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true })
  addFormats(ajv)
  ajv.addSchema(schema, schema.$id)
}

export function listDefs() { load(); return Object.keys(schema.$defs) }

export function getValidator(def) {
  load()
  if (!schema.$defs[def]) throw new Error(`unknown contract "${def}". Known: ${listDefs().join(', ')}`)
  const key = `${schema.$id}#/$defs/${def}`
  return ajv.getSchema(key) ?? ajv.compile({ $ref: key })
}

/** @returns {{ok: boolean, errors: {path: string, message: string}[]}} */
export function validate(def, obj) {
  const v = getValidator(def)
  const ok = v(obj)
  const errors = ok ? [] : v.errors.map(e => ({
    path: e.instancePath || '/',
    message: e.keyword === 'additionalProperties'
      ? `unexpected property "${e.params.additionalProperty}"`
      : e.keyword === 'required' ? `missing required property "${e.params.missingProperty}"`
      : e.keyword === 'enum' ? `${e.message}: ${JSON.stringify(e.params.allowedValues)}`
      : e.message,
  }))
  return { ok, errors }
}

export function formatErrors(errors) { return errors.map(e => `  ${e.path}: ${e.message}`).join('\n') }
