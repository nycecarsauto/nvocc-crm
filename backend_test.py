#!/usr/bin/env python3
# Comprehensive backend test suite for the NVOCC CRM (current deployed code).
import json, urllib.request, urllib.error, http.cookiejar

BASE = "http://localhost:3000"
passed = 0; failed = 0; results = []

def check(name, cond, detail=""):
    global passed, failed
    ok = bool(cond)
    passed += ok; failed += (not ok)
    results.append((ok, name, detail))

class Session:
    def __init__(self):
        self.cj = http.cookiejar.CookieJar()
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cj))
    def req(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        r = urllib.request.Request(BASE+path, data=data, method=method,
                                   headers={"Content-Type":"application/json"})
        try:
            with self.op.open(r, timeout=15) as resp:
                raw = resp.read().decode()
                return resp.status, (json.loads(raw) if raw and raw[0] in "{[" else raw)
        except urllib.error.HTTPError as e:
            raw = e.read().decode()
            try: return e.code, json.loads(raw)
            except: return e.code, raw

anon = Session(); admin = Session(); c1 = Session(); c2 = Session()

s,_ = anon.req("GET","/");            check("GET / serves app", s==200, f"http {s}")
s,_ = anon.req("GET","/barcode.js");  check("GET /barcode.js served", s==200, f"http {s}")
s,_ = anon.req("GET","/server.js");   check("GET /server.js blocked (source private)", s==404, f"http {s}")
s,_ = anon.req("GET","/db.js");       check("GET /db.js blocked (source private)", s==404, f"http {s}")

s,b = admin.req("POST","/api/login",{"username":"admin","password":"admin123"})
check("admin login ok", s==200 and b.get("user",{}).get("role")=="staff", f"http {s} {b}")
s,b = anon.req("POST","/api/login",{"username":"admin","password":"wrong"})
check("wrong password rejected", s==401, f"http {s}")
s,b = c1.req("POST","/api/register",{"username":"cust1","password":"pass123","name":"Cust One","phone":"111"})
check("customer1 register", s==201 and b.get("user",{}).get("role")=="customer" and b["user"]["client_id"], f"http {s} {b}")
s,b = c2.req("POST","/api/register",{"username":"cust2","password":"pass123","name":"Cust Two"})
check("customer2 register", s==201, f"http {s}")
s,b = anon.req("POST","/api/register",{"username":"cust1","password":"pass123"})
check("duplicate username rejected", s==400, f"http {s} {b}")
s,b = anon.req("POST","/api/register",{"username":"shorty","password":"123"})
check("short password rejected", s==400, f"http {s} {b}")
s,b = anon.req("GET","/api/me")
check("anon /api/me -> null user", s==200 and b.get("user") is None, f"http {s} {b}")

ship = {"shipper_first":"M","shipper_last":"Yarde","shipper_name":"M Yarde",
        "from_address":"109 20 132 Ave","from_city":"Queens","from_state":"NY","from_zip":"11420","from_country":"USA",
        "consignee_first":"Cardisha","consignee_last":"McMillan","consignee_name":"Cardisha McMillan",
        "to_address":"Perdmontemps, St David","to_city":"St George","to_country":"Grenada","consignee_phone":"473-419-7489",
        "pickup_date":"2026-07-16","pickup_time":"Morning (8am-12pm)","dest_port":"Grenada",
        "items":[{"item_type":"barrel","pricing_mode":"flat","description":"Barrel","quantity":3,"rate":95,"weight":50},
                 {"item_type":"box","pricing_mode":"volume","description":"BTN","quantity":2,"length":24,"width":18,"height":18,"dim_unit":"in","rate":8}]}
s,b = c1.req("POST","/api/shipments",ship)
check("c1 create shipment", s==201, f"http {s}")
check("shipper_name = first+last", b.get("shipper_name")=="M Yarde", b.get("shipper_name"))
check("consignee_name = first+last", b.get("consignee_name")=="Cardisha McMillan", b.get("consignee_name"))
check("structured address stored", b.get("from_city")=="Queens" and b.get("to_city")=="St George", f"{b.get('from_city')}/{b.get('to_city')}")
check("pickup_date stored", b.get("pickup_date")=="2026-07-16", b.get("pickup_date"))
check("pickup_time stored", b.get("pickup_time")=="Morning (8am-12pm)", b.get("pickup_time"))
check("auto BL number NV000001", b.get("bl_number")=="NV000001", b.get("bl_number"))
barrel = b["items"][0]; box = b["items"][1]
check("barrel flat charge 95*3=285", barrel["line_charge"]==285, barrel["line_charge"])
check("box volume 4.5 ft3", box["volume_each"]==4.5 and box["volume_unit"]=="ft3", f"{box['volume_each']} {box['volume_unit']}")
check("box volume charge 8*4.5*2=72", box["line_charge"]==72, box["line_charge"])
check("total charge 285+72=357", b.get("total_charge")==357, b.get("total_charge"))
check("total pieces 3+2=5", b.get("total_pieces")==5, b.get("total_pieces"))
check("total weight 50*3=150", b.get("total_weight")==150, b.get("total_weight"))
sid1 = b["id"]

s,b2 = c1.req("POST","/api/shipments",{"shipper_name":"M Yarde","consignee_name":"X","items":[{"item_type":"barrel","pricing_mode":"flat","quantity":1,"rate":95}]})
check("auto BL increments NV000002", b2.get("bl_number")=="NV000002", b2.get("bl_number"))
s,b3 = c1.req("POST","/api/shipments",{"shipper_name":"M Yarde","consignee_name":"Y","items":[{"item_type":"box","pricing_mode":"volume","quantity":1,"length":100,"width":50,"height":50,"dim_unit":"cm","rate":200}]})
bcm = b3["items"][0]
check("cm volume 0.25 CBM", bcm["volume_each"]==0.25 and bcm["volume_unit"]=="CBM", f"{bcm['volume_each']} {bcm['volume_unit']}")
check("cm volume charge 200*0.25=50", bcm["line_charge"]==50, bcm["line_charge"])

s,b = c2.req("POST","/api/shipments",{"shipper_name":"Two","consignee_name":"Z","items":[{"item_type":"barrel","pricing_mode":"flat","quantity":1,"rate":80}]})
sid_c2 = b["id"]
s,l1 = c1.req("GET","/api/shipments"); check("c1 sees only own (3)", isinstance(l1,list) and len(l1)==3, f"{len(l1) if isinstance(l1,list) else l1}")
s,l2 = c2.req("GET","/api/shipments"); check("c2 sees only own (1)", isinstance(l2,list) and len(l2)==1, f"{len(l2) if isinstance(l2,list) else l2}")
s,la = admin.req("GET","/api/shipments"); check("admin sees all (4)", isinstance(la,list) and len(la)==4, f"{len(la) if isinstance(la,list) else la}")
s,_ = c1.req("GET",f"/api/shipments/{sid_c2}"); check("c1 blocked from c2 shipment (403)", s==403, f"http {s}")
s,_ = anon.req("GET","/api/shipments"); check("anon shipments blocked (401)", s==401, f"http {s}")
s,_ = c1.req("GET","/api/clients"); check("customer clients list blocked (403)", s==403, f"http {s}")
s,_ = c1.req("GET","/api/users"); check("customer users list blocked (403)", s==403, f"http {s}")

s,b = c1.req("PUT",f"/api/shipments/{sid1}",{"shipper_name":"M Yarde","consignee_name":"Cardisha McMillan","status":"Shipped","items":[{"item_type":"barrel","pricing_mode":"flat","quantity":3,"rate":95}]})
check("customer PUT keeps status Draft", b.get("status")=="Draft", b.get("status"))
s,b = admin.req("PUT",f"/api/shipments/{sid1}",{"status":"Shipped"})
check("staff PUT sets status Shipped", b.get("status")=="Shipped", b.get("status"))
check("PUT hardening: bl_number preserved on partial update", b.get("bl_number")=="NV000001", b.get("bl_number"))
check("PUT hardening: address preserved on partial update", b.get("from_city")=="Queens", b.get("from_city"))

s,b = c1.req("GET","/api/settings")
check("settings expose company_name", b.get("company_name")=="Scotty's Caribbean Shipping", b.get("company_name"))
check("settings expose invoice_terms", "Freight charges" in (b.get("invoice_terms") or ""), b.get("invoice_terms"))
s,_ = c1.req("PUT","/api/settings",{"company_name":"Hacker Co"})
check("customer cannot edit settings (403)", s==403, f"http {s}")
s,b = admin.req("PUT","/api/settings",{"default_barrel_rate":75,"default_volume_rate":8,"currency":"USD","company_name":"NYCE Cargo & Auto"})
check("staff can update company_name", b.get("company_name")=="NYCE Cargo & Auto", b.get("company_name"))

s,b = admin.req("POST","/api/users",{"role":"customer","name":"Office Made","username":"officemade","password":"pass123"})
check("staff creates customer account", s==201 and b.get("client_id"), f"http {s} {b}")
s2 = Session(); s,b = s2.req("POST","/api/login",{"username":"officemade","password":"pass123"})
check("office-made customer can log in", s==200 and b["user"]["role"]=="customer", f"http {s}")

s,_ = c1.req("PUT","/api/password",{"current":"wrongpass","next":"newpass1"})
check("password change wrong-current rejected", s==400, f"http {s}")
s,_ = c1.req("PUT","/api/password",{"current":"pass123","next":"newpass1"})
check("password change with correct current ok", s==200, f"http {s}")

s,inv = admin.req("GET",f"/api/shipments/{sid1}")
need = ["bl_number","shipper_name","from_address","from_city","consignee_name","to_address","to_city","total_charge"]
missing = [k for k in need if not inv.get(k)]
check("shipment carries all invoice fields", not missing, f"missing: {missing}")
check("invoice items have line_charge", all("line_charge" in it for it in inv.get("items",[])), "")

print("\n================= RESULTS =================")
for ok,name,detail in results:
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f"   -> {detail}" if not ok else ""))
print("==========================================")
print(f"  TOTAL: {passed} passed, {failed} failed")
exit(1 if failed else 0)
