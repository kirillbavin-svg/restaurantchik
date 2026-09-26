import { registerKitchen } from './kitchen.mjs';
import { registerFeatures } from './features.mjs';
import express from 'express';
import multer from 'multer';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.RESTAURANT_DATA_DIR || join(root, 'data'); const uploadsDir = join(dataDir, 'uploads'); const backupDir = join(dataDir, 'backups');
[dataDir, uploadsDir, backupDir].forEach(p => mkdirSync(p, { recursive: true }));
const db = new DatabaseSync(join(dataDir, 'restaurant.db'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,name TEXT UNIQUE,password TEXT,avatar TEXT,telegram_chat TEXT);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER,expires TEXT);
CREATE TABLE IF NOT EXISTS currencies(id INTEGER PRIMARY KEY,name_one TEXT,name_few TEXT,name_many TEXT,emoji TEXT,active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS dishes(id INTEGER PRIMARY KEY,title TEXT,description TEXT DEFAULT '',ingredients TEXT DEFAULT '',category TEXT,image TEXT,created_by INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS cooks(id INTEGER PRIMARY KEY,dish_id INTEGER,user_id INTEGER,price TEXT DEFAULT '[]',availability TEXT DEFAULT 'Доступно',availability_note TEXT DEFAULT '',minutes INTEGER DEFAULT 30,note TEXT DEFAULT '',addons TEXT DEFAULT '[]',UNIQUE(dish_id,user_id));
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY,customer_id INTEGER,scheduled_at TEXT,comment TEXT DEFAULT '',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS order_items(id INTEGER PRIMARY KEY,order_id INTEGER,dish_id INTEGER,cook_id INTEGER,status TEXT DEFAULT 'новый',price TEXT,addons TEXT DEFAULT '[]',comment TEXT DEFAULT '',replacement_dish_id INTEGER,replacement_reason TEXT,cancel_requested INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS ledger(id INTEGER PRIMARY KEY,debtor_id INTEGER,creditor_id INTEGER,currency_id INTEGER,amount INTEGER,kind TEXT,ref_id INTEGER,note TEXT,confirmed INTEGER DEFAULT 1,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS reviews(id INTEGER PRIMARY KEY,order_item_id INTEGER UNIQUE,author_id INTEGER,cook_id INTEGER,dish_id INTEGER,rating INTEGER,text TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT);`);
try{db.exec('ALTER TABLE dishes ADD COLUMN archived INTEGER DEFAULT 0')}catch{}
try{db.exec('ALTER TABLE orders ADD COLUMN deleted INTEGER DEFAULT 0')}catch{}

const hash = p => { const salt=randomBytes(16).toString('hex'); return salt+':'+scryptSync(p,salt,64).toString('hex') };
const verify=(p,h)=>{const [s,x]=h.split(':');return timingSafeEqual(Buffer.from(x,'hex'),scryptSync(p,s,64))};
const seedUser=db.prepare('INSERT OR IGNORE INTO users(id,name,password) VALUES(?,?,?)');
seedUser.run(1,'Кирилл',hash(process.env.RESTAURANT_KIRILL_PASSWORD||'change-me-kirill'));
seedUser.run(2,'Ксюня',hash(process.env.RESTAURANT_KSYUNYA_PASSWORD||'change-me-ksyunya'));
const seedCurrency=db.prepare('INSERT OR IGNORE INTO currencies(id,name_one,name_few,name_many,emoji) VALUES(?,?,?,?,?)');
[['поцелуй','поцелуя','поцелуев','💋'],['комплимент','комплимента','комплиментов','💬'],['минута массажа','минуты массажа','минут массажа','💆'],['объятие','объятия','объятий','🤗']].forEach((c,i)=>seedCurrency.run(i+1,...c));

const app=express(); app.use(express.json({limit:'2mb'})); app.use('/uploads',express.static(uploadsDir));
const upload=multer({storage:multer.diskStorage({destination:uploadsDir,filename:(_,f,cb)=>{const ext={"image/jpeg":'.jpg',"image/png":'.png',"image/webp":'.webp',"image/heic":'.heic',"image/heif":'.heif'}[f.mimetype]||'';cb(null,Date.now()+'-'+randomBytes(4).toString('hex')+ext)}}),fileFilter:(_,file,cb)=>cb(null,['image/jpeg','image/png','image/webp','image/heic','image/heif'].includes(file.mimetype)),limits:{fileSize:8_000_000}});
function auth(req,res,next){const token=(req.headers.authorization||'').replace('Bearer ','');const row=db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>datetime('now')`).get(token);if(!row)return res.status(401).json({error:'Нужен вход'});req.user=row;next()}
const q=(s,...p)=>db.prepare(s).all(...p); const one=(s,...p)=>db.prepare(s).get(...p);
const transaction=(fn)=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result}catch(error){db.exec('ROLLBACK');throw error}};
async function telegram(chat,text,buttons){const token=one("SELECT value FROM settings WHERE key='telegram_token'")?.value;if(process.env.DISABLE_TELEGRAM==='1'||!token||!chat)return;await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:chat,text,reply_markup:buttons?{inline_keyboard:buttons}:undefined})}).catch(()=>{});}

registerKitchen({app,db,auth,one,q,transaction,telegram});
registerFeatures({app,db,auth,one,q,transaction,telegram});

app.post('/api/login',(req,res)=>{const u=one('SELECT * FROM users WHERE id=?',req.body.userId);if(!u||!verify(req.body.password,u.password))return res.status(401).json({error:'Неверный пароль'});const token=randomBytes(32).toString('hex');db.prepare("INSERT INTO sessions VALUES(?,?,datetime('now','+180 days'))").run(token,u.id);res.json({token,user:{id:u.id,name:u.name,avatar:u.avatar}})});
app.get('/api/me',auth,(req,res)=>res.json({id:req.user.id,name:req.user.name,avatar:req.user.avatar,telegramConnected:!!req.user.telegram_chat}));
app.post('/api/upload',auth,upload.single('image'),(req,res)=>req.file?res.json({url:'/uploads/'+req.file.filename}):res.status(400).json({error:'Поддерживаются JPG, PNG, WebP и HEIC до 8 МБ'}));
app.put('/api/profile',auth,(req,res)=>{db.prepare('UPDATE users SET avatar=COALESCE(?,avatar) WHERE id=?').run(req.body.avatar,req.user.id);res.json({ok:true})});
app.post('/api/currencies',auth,(req,res)=>{const b=req.body;const r=db.prepare('INSERT INTO currencies(name_one,name_few,name_many,emoji) VALUES(?,?,?,?)').run(b.one,b.few,b.many,b.emoji||'🪙');res.json({id:Number(r.lastInsertRowid)})});
app.patch('/api/currencies/:id',auth,(req,res)=>{db.prepare('UPDATE currencies SET active=? WHERE id=?').run(req.body.active?1:0,req.params.id);res.json({ok:true})});
app.put('/api/currencies/:id',auth,(req,res)=>{const b=req.body;if(!b.one?.trim()||!b.few?.trim()||!b.many?.trim())return res.status(400).json({error:'Заполните все формы слова'});db.prepare('UPDATE currencies SET name_one=?,name_few=?,name_many=?,emoji=? WHERE id=?').run(b.one.trim(),b.few.trim(),b.many.trim(),b.emoji?.trim()||'🪙',req.params.id);res.json({ok:true})});
app.delete('/api/currencies/:id',auth,(req,res)=>{db.prepare('UPDATE currencies SET active=0 WHERE id=?').run(req.params.id);res.json({ok:true})});
app.delete('/api/dishes/:id/leave',auth,(req,res)=>{const owned=one('SELECT id FROM cooks WHERE dish_id=? AND user_id=?',req.params.id,req.user.id);if(!owned)return res.status(403).json({error:'Вы не готовите это блюдо'});db.prepare('DELETE FROM cooks WHERE dish_id=? AND user_id=?').run(req.params.id,req.user.id);if(!one('SELECT id FROM cooks WHERE dish_id=?',req.params.id))db.prepare('UPDATE dishes SET archived=1 WHERE id=?').run(req.params.id);res.json({ok:true})});
app.delete('/api/orders/:id',auth,(req,res)=>{const order=one('SELECT * FROM orders WHERE id=? AND deleted=0',req.params.id);if(!order)return res.status(404).json({error:'Заказ не найден'});const cooks=q('SELECT DISTINCT cook_id FROM order_items WHERE order_id=?',order.id).map(x=>x.cook_id);const participates=order.customer_id===req.user.id||cooks.includes(req.user.id);if(!participates)return res.status(403).json({error:'Это не ваш заказ'});if(!verify(String(req.body.password||''),req.user.password))return res.status(401).json({error:'Неверный пароль'});db.prepare('UPDATE orders SET deleted=1 WHERE id=?').run(order.id);app.locals.emitUpdate?.([order.customer_id,...cooks]);res.json({ok:true})});
app.put('/api/settings/telegram',auth,async(req,res)=>{const token=String(req.body.token||'').trim();if(!token)return res.status(400).json({error:'Введите токен бота'});try{const result=await fetch('https://api.telegram.org/bot'+token+'/getMe').then(r=>r.json());if(!result.ok)return res.status(400).json({error:'Telegram не принял токен'});transaction(()=>{db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('telegram_token',?)").run(token);db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('telegram_username',?)").run(result.result.username);db.prepare("DELETE FROM settings WHERE key='tg_offset'").run()});res.json({ok:true,username:result.result.username})}catch{return res.status(503).json({error:'Не удалось связаться с Telegram'})}});
app.post('/api/telegram/link',auth,async(req,res)=>{let username=one("SELECT value FROM settings WHERE key='telegram_username'")?.value;const token=one("SELECT value FROM settings WHERE key='telegram_token'")?.value;if(!username&&token){const info=await fetch('https://api.telegram.org/bot'+token+'/getMe').then(r=>r.json()).catch(()=>null);username=info?.result?.username;if(username)db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('telegram_username',?)").run(username)}if(!username)return res.status(400).json({error:'Сначала сохраните токен бота'});db.prepare("DELETE FROM settings WHERE key LIKE 'tg_code_%' AND value=?").run(String(req.user.id));const code=String(Math.floor(100000+Math.random()*900000));db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run('tg_code_'+code,String(req.user.id));res.json({code,username,url:'https://t.me/'+username+'?start='+code})});
app.get('/api/backup',auth,(req,res)=>{const name=`restaurantchik-${new Date().toISOString().slice(0,10)}.tar.gz`;res.attachment(name);const p=spawn('tar',['-czf','-','restaurant.db','uploads'],{cwd:dataDir});p.stdout.pipe(res)});
app.post('/api/reset-activity',auth,(req,res)=>{if(!verify(String(req.body.password||''),req.user.password))return res.status(401).json({error:'Неверный пароль'});const stamp=new Date().toISOString().replaceAll(':','-').replaceAll('.','-');const backup=join(backupDir,'before-activity-reset-'+stamp+'.sqlite');db.exec("VACUUM INTO '"+backup.replaceAll("'","''")+"'");transaction(()=>{db.exec("DELETE FROM replacements; DELETE FROM notifications; DELETE FROM reviews; DELETE FROM ledger; DELETE FROM order_items; DELETE FROM orders;")});db.exec('PRAGMA wal_checkpoint(TRUNCATE)');app.locals.emitUpdate?.([1,2]);res.json({ok:true,backup:backup.slice(root.length+1)})});
app.use(express.static(join(root,'dist-local')));app.get('/{*splat}',(req,res)=>res.sendFile(join(root,'dist-local','index.html')));

async function pollTelegram(){const token=one("SELECT value FROM settings WHERE key='telegram_token'")?.value;if(!token){setTimeout(pollTelegram,5000);return}let offset=Number(one("SELECT value FROM settings WHERE key='tg_offset'")?.value||0);try{const data=await fetch(`https://api.telegram.org/bot${token}/getUpdates?timeout=20&offset=${offset}`).then(r=>r.json());for(const u of data.result||[]){offset=u.update_id+1;if(u.message?.text){const code=u.message.text.replace(/^\/start\s*/,'').trim();const uid=one('SELECT value FROM settings WHERE key=?','tg_code_'+code)?.value;if(uid){db.prepare('UPDATE users SET telegram_chat=? WHERE id=?').run(String(u.message.chat.id),uid);db.prepare('DELETE FROM settings WHERE key=?').run('tg_code_'+code);await telegram(String(u.message.chat.id),'✅ Telegram подключён к «Ресторанчику»')}}if(u.callback_query){const [,oid,status]=u.callback_query.data.split(':');db.prepare('UPDATE order_items SET status=? WHERE order_id=?').run(status,oid);await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery?callback_query_id=${u.callback_query.id}`)}}db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('tg_offset',?)").run(String(offset))}catch{}setTimeout(pollTelegram,1500)}
function dailyBackup(){const out=join(backupDir,`restaurantchik-${new Date().toISOString().slice(0,10)}.tar.gz`);if(!existsSync(out))spawn('tar',['-czf',out,'restaurant.db','uploads'],{cwd:dataDir});for(const f of readdirSync(backupDir).map(x=>join(backupDir,x)).sort((a,b)=>statSync(b).mtimeMs-statSync(a).mtimeMs).slice(7))unlinkSync(f)}
setInterval(dailyBackup,60*60*1000);dailyBackup();if(process.env.DISABLE_TELEGRAM!=='1')pollTelegram();
app.listen(Number(process.env.PORT||3030),'0.0.0.0',()=>console.log('Ресторанчик: http://localhost:3030'));
