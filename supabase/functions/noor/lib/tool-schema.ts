type Schema = Record<string, any>;
const unsupported=new Set(['minimum','maximum','minLength','maxLength','multipleOf','exclusiveMinimum','exclusiveMaximum']);

// Strict tool use supports a subset of JSON Schema. Keep the committed schema
// intact for backend validation and adapt only the copy sent to the provider.
export function providerSchema(schema:Schema):Schema {
  const result:Schema={};
  for(const [key,value] of Object.entries(schema)) {
    if(unsupported.has(key)) continue;
    if(key==='properties') result[key]=Object.fromEntries(Object.entries(value).map(([k,v])=>[k,providerSchema(v as Schema)]));
    else if(key==='items') result[key]=providerSchema(value as Schema);
    else result[key]=value;
  }
  const hints=Object.entries(schema).filter(([k])=>unsupported.has(k)).map(([k,v])=>`${k}: ${v}`);
  if(hints.length) result.description=[schema.description,...hints].filter(Boolean).join('; ');
  return result;
}

export function validateToolInput(schema:Schema,value:unknown,path='input'):void {
  const fail=(reason:string):never=>{throw new Error(`${path}: ${reason}`);};
  const types=Array.isArray(schema.type)?schema.type:[schema.type];
  if(schema.type&&!types.some((type:string)=>type==='null'?value===null:type==='array'?Array.isArray(value):type==='object'?value!==null&&typeof value==='object'&&!Array.isArray(value):type==='integer'?Number.isInteger(value):typeof value===type)) fail('invalid type');
  if(schema.enum&&!schema.enum.includes(value)) fail('invalid value');
  if(typeof value==='number') {
    if(!Number.isFinite(value)) fail('invalid number');
    if(schema.minimum!==undefined&&value<schema.minimum) fail('below minimum');
    if(schema.maximum!==undefined&&value>schema.maximum) fail('above maximum');
  }
  if(typeof value==='string') {
    if(schema.minLength!==undefined&&value.length<schema.minLength) fail('too short');
    if(schema.maxLength!==undefined&&value.length>schema.maxLength) fail('too long');
    if(schema.pattern&&!new RegExp(schema.pattern).test(value)) fail('invalid format');
    if(schema.format==='date'&&!/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('invalid date');
    if(schema.format==='uuid'&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) fail('invalid UUID');
  }
  if(Array.isArray(value)&&schema.items) value.forEach((v,i)=>validateToolInput(schema.items,v,`${path}[${i}]`));
  if(value!==null&&typeof value==='object'&&!Array.isArray(value)) {
    const input=value as Record<string,unknown>;
    for(const key of schema.required??[]) if(!(key in input)) fail(`missing ${key}`);
    for(const [key,v] of Object.entries(input)) {
      if(schema.properties?.[key]) validateToolInput(schema.properties[key],v,`${path}.${key}`);
      else if(schema.additionalProperties===false) fail(`unexpected ${key}`);
    }
  }
}
