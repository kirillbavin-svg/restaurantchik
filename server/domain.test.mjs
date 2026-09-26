import test from 'node:test';
import assert from 'node:assert/strict';
import {isCookAvailable,multiplyPrice,normalizeQuantity} from './domain.mjs';

test('обычное доступное блюдо можно заказать в любой день',()=>assert.equal(isCookAvailable({availability:'Доступно'},null,new Date('2026-09-11')),true));
test('блюдо выходного дня недоступно в пятницу и доступно в субботу',()=>{assert.equal(isCookAvailable({availability:'Только по выходным'},null,new Date('2026-09-11')),false);assert.equal(isCookAvailable({availability:'Только по выходным'},null,new Date('2026-09-12')),true)});
test('количество ограничено диапазоном от 1 до 20',()=>{assert.equal(normalizeQuantity(3),3);assert.throws(()=>normalizeQuantity(0));assert.throws(()=>normalizeQuantity(21));assert.throws(()=>normalizeQuantity(1.5))});
test('цена умножается без изменения исходного снимка',()=>{const price=[{currency_id:1,amount:2}];assert.deepEqual(multiplyPrice(price,3),[{currency_id:1,amount:6}]);assert.equal(price[0].amount,2)});
