from conftest import login


def test_login_falsches_passwort(client):
    r = client.post("/api/auth/login", json={"benutzername": "RKO", "passwort": "falsch"})
    assert r.status_code == 401


def test_geschuetzt_ohne_login(client):
    assert client.get("/api/me/uebersicht").status_code == 401


def test_login_und_einstellungen(client):
    user = login(client, "RKO")
    assert user["rolle"] == "admin"
    r = client.put("/api/me/einstellungen", json={"theme": "dunkel", "akzentfarbe": "#2563eb", "planung_wochen": 8})
    assert r.status_code == 200
    me = client.get("/api/auth/me").json["user"]
    assert me["einstellungen"] == {"theme": "dunkel", "akzentfarbe": "#2563eb", "planung_wochen": 8}
    assert client.put("/api/me/einstellungen", json={"akzentfarbe": "grün"}).status_code == 400


def test_uebersicht(client):
    login(client, "RKO")
    data = client.get("/api/me/uebersicht").json
    assert {"aufgaben", "auftraege", "ausruestung", "uebergaben"} <= data.keys()


def _baustein(client, name):
    return next(a for a in client.get("/api/planung/bausteine").json["abwesenheiten"] if a["bezeichnung"] == name)


def test_planung_anlegen_konflikt_ersetzen(client):
    login(client, "RKO")
    buero = _baustein(client, "Büro")
    krank = _baustein(client, "Krank")
    neu = {"quelle_typ": "abwesenheit", "quelle_id": buero["id"], "datum": "2027-03-01", "arbeitstage": 3}
    r = client.post("/api/planung", json=neu)
    assert r.status_code == 200, r.json
    eintrag = r.json["eintrag"]
    assert (eintrag["start_datum"], eintrag["ende_datum"]) == ("2027-03-01", "2027-03-03")

    konflikt = {"quelle_typ": "abwesenheit", "quelle_id": krank["id"], "datum": "2027-03-02"}
    r = client.post("/api/planung", json=konflikt)
    assert r.status_code == 409
    assert r.json["konflikt"]["name"] == "Büro"

    r = client.post("/api/planung", json={**konflikt, "replace": True})
    assert r.status_code == 200
    plan = client.get("/api/planung?von=2027-03-01&wochen=1").json["eintraege"]
    zeitraeume = sorted((e["titel"], e["start_datum"], e["ende_datum"]) for e in plan)
    assert zeitraeume == [
        ("Büro", "2027-03-01", "2027-03-01"),
        ("Büro", "2027-03-03", "2027-03-03"),
        ("Krank", "2027-03-02", "2027-03-02"),
    ]


def test_wochenende_gesperrt(client):
    login(client, "RKO")
    buero = _baustein(client, "Büro")
    r = client.post("/api/planung", json={"quelle_typ": "abwesenheit", "quelle_id": buero["id"], "datum": "2027-03-06"})
    assert r.status_code == 400


def test_verschieben_behaelt_arbeitstage(client):
    login(client, "RKO")
    buero = _baustein(client, "Büro")
    r = client.post(
        "/api/planung", json={"quelle_typ": "abwesenheit", "quelle_id": buero["id"], "datum": "2027-03-10", "arbeitstage": 3}
    )
    pid = r.json["eintrag"]["id"]
    r = client.post(f"/api/planung/{pid}/verschieben", json={"start_datum": "2027-03-12"})
    assert r.status_code == 200, r.json
    assert (r.json["eintrag"]["start_datum"], r.json["eintrag"]["ende_datum"]) == ("2027-03-12", "2027-03-16")

    r = client.patch(f"/api/planung/{pid}", json={"ende_datum": "2027-03-19"})
    assert r.json["eintrag"]["ende_datum"] == "2027-03-19"
    assert client.delete(f"/api/planung/{pid}").status_code == 200


def test_mitarbeiter_nur_eigene_planung(client, app):
    login(client, "RKO")
    buero = _baustein(client, "Büro")
    r = client.post("/api/planung", json={"quelle_typ": "abwesenheit", "quelle_id": buero["id"], "datum": "2027-04-05"})
    fremd = r.json["eintrag"]["id"]
    client.post("/api/auth/logout")

    login(client, "FRF")
    assert client.delete(f"/api/planung/{fremd}").status_code == 403
    r = client.post(
        "/api/planung", json={"mitarbeiter_id": 3, "quelle_typ": "abwesenheit", "quelle_id": buero["id"], "datum": "2027-04-06"}
    )
    assert r.status_code == 403
    r = client.post("/api/planung", json={"quelle_typ": "abwesenheit", "quelle_id": buero["id"], "datum": "2027-04-06"})
    assert r.status_code == 200
    assert r.json["eintrag"]["mitarbeiter_id"] == 2


def test_auftrag_suche_und_planen(client):
    login(client, "RKO")
    treffer = client.get("/api/auftraege/suche?q=Wartung").json["auftraege"]
    assert treffer
    r = client.post("/api/planung", json={"quelle_typ": "auftrag", "quelle_id": treffer[0]["id"], "datum": "2027-05-03"})
    assert r.status_code == 200
    assert r.json["eintrag"]["typ"] == "auftrag"


def test_objektbaum_und_details(client):
    login(client, "RKO")
    kunden = client.get("/api/baum").json["kunden"]
    system = next(s for k in kunden for s in k["systeme"] if s["isps"])
    assert client.get(f"/api/systeme/{system['id']}").status_code == 200
    isp = system["isps"][0]
    assert client.get(f"/api/isps/{isp['id']}").status_code == 200
    anlage = next(a for k in kunden for s in k["systeme"] for i in s["isps"] for a in i["anlagen"] if a["geraete"])
    data = client.get(f"/api/anlagen/{anlage['id']}").json
    assert data["geraete"]
    assert client.get(f"/api/geraete/{data['geraete'][0]['id']}").status_code == 200
    assert client.get("/api/anlagen/999999").status_code == 404


def test_auftraege_liste_detail_status(client):
    login(client, "RKO")
    liste = client.get("/api/auftraege").json["auftraege"]
    assert liste and all(a["status"] != "storniert" for a in liste)
    assert any(a["status"] == "storniert" for a in client.get("/api/auftraege?storniert=1").json["auftraege"])
    wartung = next(a for a in liste if a["wartung_gesamt"])
    d = client.get(f"/api/auftraege/{wartung['id']}").json
    assert d["auftrag"]["wartung_erledigt"] <= d["auftrag"]["wartung_gesamt"]
    stamm = client.get("/api/auftraege/stammdaten").json
    erledigt = next(s["id"] for s in stamm["status"] if s["name"] == "erledigt")
    r = client.patch(f"/api/auftraege/{wartung['id']}/status", json={"status_id": erledigt})
    assert r.json["auftrag"]["status"] == "erledigt"


def test_auftrag_anlegen_bearbeiten(client):
    login(client, "RKO")
    stamm = client.get("/api/auftraege/stammdaten").json
    neu = {"name": "Testauftrag", "system_id": stamm["systeme"][0]["id"], "typ_id": stamm["typen"][0]["id"], "status_id": 1}
    a = client.post("/api/auftraege", json=neu).json["auftrag"]
    assert a["name"] == "Testauftrag" and a["status"] == "angeboten"
    a = client.put(f"/api/auftraege/{a['id']}", json={**neu, "name": "Umbenannt", "plan_tage": 3}).json["auftrag"]
    assert (a["name"], a["plan_tage"]) == ("Umbenannt", 3)
    assert client.post("/api/auftraege", json={"name": ""}).status_code == 400
    r = client.post(f"/api/auftraege/{a['id']}/aufgaben", json={"titel": "Klappen prüfen"})
    aid = r.json["id"]
    assert client.patch(f"/api/aufgaben/{aid}", json={"status": "in arbeit"}).status_code == 200
    assert client.get(f"/api/auftraege/{a['id']}").json["aufgaben"][0]["status"] == "in arbeit"


def test_mitarbeiter_darf_auftrag_nicht_aendern(client):
    login(client, "FRF")
    a = client.get("/api/auftraege").json["auftraege"][0]
    assert client.patch(f"/api/auftraege/{a['id']}/status", json={"status_id": 4}).status_code == 403
    assert client.get("/api/auftraege/stammdaten").json["darf_bearbeiten"] is False
