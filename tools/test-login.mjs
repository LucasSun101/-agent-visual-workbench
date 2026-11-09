// 验证口令登录：登录页、错口令、对号令、带 cookie 取数据、无 cookie 被拒。
const B = process.env.WB_URL || "http://127.0.0.1:51425";
const code = process.argv[2];
if (!code) {
  console.error("usage: node test-login.mjs <passcode>");
  process.exit(2);
}

const form = (body) => ({
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body,
  redirect: "manual",
});

let ok = 0;
const bad = 0;
const check = (name, pass, extra = "") => {
  if (pass) ok++;
  console.log(`${pass ? "✓" : "✗"} ${name}${extra ? " · " + extra : ""}`);
};

const root = await fetch(`${B}/`, { redirect: "manual" });
const html = await root.text();
check("GET / 返回登录页", root.status === 200 && html.includes('name="code"'), `HTTP ${root.status}`);

const wrong = await fetch(`${B}/login`, form("code=nope"));
check("错口令 → 401", wrong.status === 401, `HTTP ${wrong.status}`);

const good = await fetch(`${B}/login`, form(`code=${encodeURIComponent(code)}`));
const sc = good.headers.get("set-cookie") ?? "";
check("对口令 → 303 + cookie", good.status === 303 && sc.length > 0, `HTTP ${good.status}`);
check("cookie 是 HttpOnly + SameSite", /HttpOnly/i.test(sc) && /SameSite=Lax/i.test(sc));

const cookie = sc.split(";")[0];
const withCookie = await fetch(`${B}/api/state`, { headers: { cookie } });
check("带 cookie 能取 state", withCookie.status === 200);

const without = await fetch(`${B}/api/state`);
check("无 cookie 被拒", without.status === 401, `HTTP ${without.status}`);

const page = await fetch(`${B}/`, { headers: { cookie } });
check("登录后能看到主界面", page.status === 200 && (await page.text()).includes('id="lanes"'));

console.log(`\n${ok} 通过`);
