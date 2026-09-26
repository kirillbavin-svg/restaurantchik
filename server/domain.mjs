export function isCookAvailable(cook, scheduledAt=null, now=new Date()){
  if(cook?.availability==='Доступно')return true;
  const date=scheduledAt?new Date(scheduledAt):now;
  return cook?.availability==='Только по выходным'&&Number.isFinite(date.getTime())&&[0,6].includes(date.getDay());
}

export function normalizeQuantity(value){
  const quantity=Number(value??1);
  if(!Number.isInteger(quantity)||quantity<1||quantity>20)throw Error('Количество должно быть от 1 до 20');
  return quantity;
}

export function multiplyPrice(parts,quantity){
  return parts.map(part=>({...part,amount:part.amount*quantity}));
}
