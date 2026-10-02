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


def _wartungsauftrag(client, typ=None):
    for a in client.get("/api/wartung?alle=1").json["auftraege"]:
        d = client.get(f"/api/wartung/{a['id']}").json
        aufgaben = [t for t in d["aufgaben"] if typ is None or t["typ"] == typ]
        if aufgaben:
            return d, aufgaben[0]
    raise AssertionError(f"kein Wartungsauftrag mit {typ}")


def test_wartung_ergebnis_und_oeffnen(client):
    login(client, "FRF")
    d, t = _wartungsauftrag(client, "standard")
    assert d["auftrag"]["id"] and t["isp"] and t["anlage"]
    r = client.post(f"/api/wartungsaufgaben/{t['id']}/ergebnis", json={"ergebnis": "achtung"})
    assert r.status_code == 200
    a = r.json["aufgabe"]
    assert (a["status"], a["ergebnis"]) == ("erledigt", "achtung") and a["techniker"]
    assert client.post(f"/api/wartungsaufgaben/{t['id']}/ergebnis", json={"ergebnis": "super"}).status_code == 400
    a = client.post(f"/api/wartungsaufgaben/{t['id']}/oeffnen").json["aufgabe"]
    assert (a["status"], a["ergebnis"], a["techniker"]) == ("offen", "neutral", "")


def test_wartung_messungen(client):
    login(client, "RKO")
    _, t = _wartungsauftrag(client, "fuehlerkalibrierung")
    r = client.post(f"/api/wartungsaufgaben/{t['id']}/messung", json={"gemessen": "21,5", "angezeigt": "21", "offset_alt": "0.2"})
    assert r.status_code == 200, r.json
    assert r.json["aufgabe"]["kalibrierung_offset_neu"] == 0.7 and r.json["aufgabe"]["ergebnis"] == "gut"
    assert client.post(f"/api/wartungsaufgaben/{t['id']}/messung", json={"gemessen": "x"}).status_code == 400

    _, s = _wartungsauftrag(client, "strommessung")
    r = client.post(f"/api/wartungsaufgaben/{s['id']}/messung", json={"spannung": 230, "l1": "3.2"})
    assert r.status_code == 200 and r.json["aufgabe"]["strom_l2"] is None
    assert client.post(f"/api/wartungsaufgaben/{s['id']}/messung", json={"spannung": 400, "l1": 1}).status_code == 400

    _, std = _wartungsauftrag(client, "standard")
    assert client.post(f"/api/wartungsaufgaben/{std['id']}/messung", json={}).status_code == 400


def test_wartung_kommentare(client):
    login(client, "FRF")
    d, t = _wartungsauftrag(client)
    kid = client.post(f"/api/wartungsaufgaben/{t['id']}/kommentare", json={"kommentar": "Filter verschmutzt", "intern": True}).json["id"]
    assert client.put(f"/api/wartungskommentare/{kid}", json={"kommentar": "Filter getauscht"}).status_code == 200
    client.post("/api/auth/logout")
    login(client, "RKO")
    d = client.get(f"/api/wartung/{d['auftrag']['id']}").json
    k = next(k for k in d["kommentare"] if k["id"] == kid)
    assert (k["kommentar"], k["intern"]) == ("Filter getauscht", 0)
    fremd = client.post(f"/api/wartungsaufgaben/{t['id']}/kommentare", json={"kommentar": "Admin"}).json["id"]
    client.post("/api/auth/logout")
    login(client, "FRF")
    assert client.delete(f"/api/wartungskommentare/{fremd}").status_code == 403
    assert client.delete(f"/api/wartungskommentare/{kid}").status_code == 200


def test_wartung_fotos(client, app):
    import io

    from PIL import Image

    login(client, "FRF")
    _, t = _wartungsauftrag(client)
    puffer = io.BytesIO()
    Image.new("RGB", (3000, 1500), "red").save(puffer, "JPEG")
    puffer.seek(0)
    r = client.post(
        f"/api/wartungsaufgaben/{t['id']}/fotos",
        data={"fotos": (puffer, "Schaden Klappe.jpg")},
        content_type="multipart/form-data",
    )
    assert r.status_code == 200, r.json
    fid = r.json["ids"][0]
    datei = client.get(f"/api/fotos/{fid}/datei")
    assert datei.status_code == 200
    assert max(Image.open(io.BytesIO(datei.data)).size) == 2048
    kaputt = client.post(
        f"/api/wartungsaufgaben/{t['id']}/fotos",
        data={"fotos": (io.BytesIO(b"kein bild"), "x.jpg")},
        content_type="multipart/form-data",
    )
    assert kaputt.status_code == 400
    assert client.patch(f"/api/fotos/{fid}", json={"im_wartungsbericht": True}).status_code == 200
    assert client.delete(f"/api/fotos/{fid}").status_code == 200
    assert client.get(f"/api/fotos/{fid}/datei").status_code == 404


def test_team_planung_und_umplanen(client):
    login(client, "RKO")
    team = client.get("/api/team-planung?von=2027-06-07&wochen=2").json
    assert team["voll"] and len(team["mitarbeiter"]) > 1 and team["bis"] == "2027-06-20"
    andere = next(m for m in team["mitarbeiter"] if m["id"] != 3)
    buero = _baustein(client, "Büro")
    r = client.post("/api/planung", json={"mitarbeiter_id": 3, "quelle_typ": "abwesenheit", "quelle_id": buero["id"], "datum": "2027-06-08", "arbeitstage": 2})
    pid = r.json["eintrag"]["id"]
    r = client.post(f"/api/planung/{pid}/verschieben", json={"start_datum": "2027-06-10", "mitarbeiter_id": andere["id"]})
    assert r.status_code == 200, r.json
    assert (r.json["eintrag"]["mitarbeiter_id"], r.json["eintrag"]["ende_datum"]) == (andere["id"], "2027-06-11")
    team = client.get("/api/team-planung?von=2027-06-07&wochen=2").json
    assert any(e["id"] == pid and e["mitarbeiter_id"] == andere["id"] for e in team["eintraege"])
    client.post("/api/auth/logout")

    login(client, "FRF")
    team = client.get("/api/team-planung?von=2027-06-07").json
    assert not team["voll"]
    assert {m["darf_bearbeiten"] for m in team["mitarbeiter"] if m["id"] != 2} <= {False}
    r = client.post("/api/planung", json={"quelle_typ": "abwesenheit", "quelle_id": buero["id"], "datum": "2027-06-14"})
    eigen = r.json["eintrag"]["id"]
    assert client.post(f"/api/planung/{eigen}/verschieben", json={"start_datum": "2027-06-15", "mitarbeiter_id": 3}).status_code == 403


def test_mitarbeiter_liste_detail_und_bearbeiten(client):
    login(client, "RKO")
    liste = client.get("/api/mitarbeiter").json["mitarbeiter"]
    assert any(m["id"] == 2 for m in liste)
    d = client.get("/api/mitarbeiter/2").json
    assert {"mitarbeiter", "schulungen", "systeme", "ausruestung"} <= d.keys()
    m = d["mitarbeiter"]
    neu = {**m, "funktion": "Obermonteur", "in_wochenplanung": False}
    r = client.put("/api/mitarbeiter/2", json=neu)
    assert r.status_code == 200, r.json
    assert (r.json["mitarbeiter"]["funktion"], r.json["mitarbeiter"]["in_wochenplanung"]) == ("Obermonteur", 0)
    assert all(t["id"] != 2 for t in client.get("/api/team-planung").json["mitarbeiter"])
    assert client.put("/api/mitarbeiter/3", json={"nachname": "Köster", "aktiv": False}).status_code == 400

    neu = client.post("/api/mitarbeiter", json={"vorname": "Neu", "nachname": "Techniker", "niederlassung_id": None}).json["mitarbeiter"]
    assert client.post(f"/api/mitarbeiter/{neu['id']}/schulungen", json={"bezeichnung": "SCC", "datum": "2026-01-15"}).status_code == 200
    system = client.get("/api/mitarbeiter/stammdaten").json["systeme"][0]["id"]
    assert client.post(f"/api/mitarbeiter/{neu['id']}/systeme", json={"system_id": system, "hauptverantwortlich": True}).status_code == 200
    assert client.post(f"/api/mitarbeiter/{neu['id']}/systeme", json={"system_id": system}).status_code == 409
    d = client.get(f"/api/mitarbeiter/{neu['id']}").json
    assert d["schulungen"][0]["bezeichnung"] == "SCC" and d["systeme"][0]["hauptverantwortlich"] == 1

    assert client.put(f"/api/mitarbeiter/{neu['id']}/zugang", json={"benutzername": "NTE", "rolle": "mitarbeiter"}).status_code == 400
    assert client.put(f"/api/mitarbeiter/{neu['id']}/zugang", json={"benutzername": "FRF", "passwort": "geheim1234"}).status_code == 409
    r = client.put(f"/api/mitarbeiter/{neu['id']}/zugang", json={"benutzername": "NTE", "rolle": "mitarbeiter", "passwort": "geheim1234"})
    assert r.status_code == 200
    assert client.put("/api/mitarbeiter/3/zugang", json={"benutzername": "RKO", "rolle": "mitarbeiter"}).status_code == 400
    client.post("/api/auth/logout")
    r = client.post("/api/auth/login", json={"benutzername": "NTE", "passwort": "geheim1234"})
    assert r.status_code == 200 and r.json["user"]["muss_passwort_aendern"]


def test_mitarbeiter_reihenfolge_und_rechte(client):
    login(client, "RKO")
    ids = [m["id"] for m in client.get("/api/team-planung").json["mitarbeiter"]]
    umgedreht = list(reversed(ids))
    assert client.post("/api/mitarbeiter/reihenfolge", json={"ids": umgedreht}).status_code == 200
    assert [m["id"] for m in client.get("/api/team-planung").json["mitarbeiter"] if m["niederlassung_id"] is None] == [
        i for i in umgedreht if i in {m["id"] for m in client.get("/api/team-planung").json["mitarbeiter"] if m["niederlassung_id"] is None}
    ]
    client.post("/api/auth/logout")
    login(client, "FRF")
    assert client.get("/api/mitarbeiter").status_code == 200
    assert client.put("/api/mitarbeiter/2", json={"nachname": "X"}).status_code == 403
    assert client.put("/api/mitarbeiter/2/zugang", json={"benutzername": "FRF"}).status_code == 403
    assert "benutzername" not in client.get("/api/mitarbeiter/3").json["mitarbeiter"]


def test_stammdaten(client):
    login(client, "RKO")
    listen = {l["slug"]: l for l in client.get("/api/stammdaten").json["listen"]}
    assert {"niederlassungen", "abwesenheitsarten", "auftragstypen", "geraetearten"} <= listen.keys()
    nl = client.get("/api/stammdaten/niederlassungen").json
    benutzt = next(e for e in nl["eintraege"] if e["verwendung"])
    assert client.delete(f"/api/stammdaten/niederlassungen/{benutzt['id']}").status_code == 409
    r = client.post("/api/stammdaten/auftragstypen", json={"TAName": "Prüfung", "TAPlanungsfarbe": "#123456"})
    assert r.status_code == 200
    tid = r.json["id"]
    assert client.put(f"/api/stammdaten/auftragstypen/{tid}", json={"TAName": "Prüfung", "TAPlanungsfarbe": "blau"}).status_code == 400
    assert client.put(f"/api/stammdaten/auftragstypen/{tid}", json={"TAName": "E-Check", "TAPlanungsfarbe": "#654321"}).status_code == 200
    assert any(e["TAName"] == "E-Check" for e in client.get("/api/stammdaten/auftragstypen").json["eintraege"])
    assert client.delete(f"/api/stammdaten/auftragstypen/{tid}").status_code == 200
    assert client.post("/api/stammdaten/feiertage", json={"datum": "2027-12-24", "bezeichnung": "", "farbe": "#facc15"}).status_code == 400
    client.post("/api/auth/logout")
    login(client, "FRF")
    assert client.post("/api/stammdaten/auftragstypen", json={"TAName": "X", "TAPlanungsfarbe": "#123456"}).status_code == 403
