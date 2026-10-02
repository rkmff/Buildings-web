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


def test_objekte_bearbeiten(client):
    login(client, "RKO")
    assert all(client.get("/api/baum").json["rechte"].values())
    r = client.post("/api/objekte/kunde", json={"werte": {"KUName": "Testkunde GmbH", "KUOrt": "Köln"}})
    assert r.status_code == 201, r.json
    kid = r.json["id"]
    assert client.post("/api/objekte/kunde", json={"werte": {"KUName": "  "}}).status_code == 400

    form = client.get("/api/objekt-formular/system").json
    nl = form["auswahl"]["niederlassungen"][0]["id"]
    r = client.post("/api/objekte/system", json={"eltern_id": kid, "werte": {"KSName": "Halle 1", "KSNiederlassung": nl}})
    assert r.status_code == 201, r.json
    sid = r.json["id"]
    assert client.get(f"/api/systeme/{sid}").json["system"]["KSKunde"] == "Testkunde GmbH"
    assert client.post("/api/objekte/system", json={"eltern_id": 999999, "werte": {"KSName": "X"}}).status_code == 400
    assert client.post("/api/objekte/system", json={"eltern_id": kid, "werte": {"KSName": "X", "KSDDC": 999999}}).status_code == 400

    isp = client.post("/api/objekte/isp", json={"eltern_id": sid, "werte": {"ISName": "ISP 01"}}).json["id"]
    anlage = client.post("/api/objekte/anlage", json={"eltern_id": isp, "werte": {"ANName": "Lüftung"}}).json["id"]
    r = client.post("/api/objekte/geraet", json={"eltern_id": anlage, "werte": {
        "GRName": "Zuluftventilator", "GRBMKZ": "LA01-M01", "GRNennstrom": "4,5", "GRBaujahr": "2019", "GRWartungspflichtig": True}})
    assert r.status_code == 201, r.json
    gid = r.json["id"]
    g = client.get(f"/api/geraete/{gid}").json["geraet"]
    assert (g["GRNennstrom"], g["GRBaujahr"], g["GRWartungspflichtig"]) == (4.5, 2019, 1)
    assert client.put(f"/api/objekte/geraet/{gid}", json={"werte": {"GRBaujahr": "19,5"}}).status_code == 400

    # Umbenennen des Kunden zieht den Namen im System nach
    assert client.put(f"/api/objekte/kunde/{kid}", json={"werte": {"KUName": "Testkunde AG"}}).status_code == 200
    assert client.get(f"/api/systeme/{sid}").json["system"]["KSKunde"] == "Testkunde AG"

    ap = client.post("/api/objekte/ansprechpartner", json={"system_id": sid, "werte": {"APNachname": "Meier", "APTelefon": "0221 1"}})
    assert ap.status_code == 201
    assert client.get(f"/api/systeme/{sid}").json["ansprechpartner"][0]["nachname"] == "Meier"
    assert client.post("/api/objekte/ansprechpartner", json={"werte": {"APNachname": "X"}}).status_code == 400

    # Verwendete Objekte lassen sich nicht löschen
    form = client.get(f"/api/objekt-formular/system?id={sid}").json
    assert {v["label"] for v in form["verwendung"]} == {"ISP", "Ansprechpartner"}
    r = client.delete(f"/api/objekte/kunde/{kid}")
    assert r.status_code == 409 and "1 System" in r.json["message"]
    assert client.delete(f"/api/objekte/anlage/{anlage}").status_code == 409

    # Umhängen: Gerät in eine andere Anlage
    anlage2 = client.post("/api/objekte/anlage", json={"eltern_id": isp, "werte": {"ANName": "Heizung"}}).json["id"]
    assert client.put(f"/api/objekte/geraet/{gid}", json={"eltern_id": anlage2, "werte": {}}).status_code == 200
    assert client.get(f"/api/geraete/{gid}").json["geraet"]["anlage_id"] == anlage2
    assert client.delete(f"/api/objekte/anlage/{anlage}").status_code == 200

    for typ, pk in (("geraet", gid), ("anlage", anlage2), ("isp", isp), ("ansprechpartner", ap.json["id"]), ("system", sid), ("kunde", kid)):
        assert client.delete(f"/api/objekte/{typ}/{pk}").status_code == 200, typ

    client.post("/api/auth/logout")
    ich = login(client, "FRF")
    rechte = client.get("/api/baum").json["rechte"]
    assert rechte == {"kunde": False, "system": False, "isp": True, "anlage": True, "geraet": True, "ansprechpartner": False}
    assert client.post("/api/objekte/kunde", json={"werte": {"KUName": "X"}}).status_code == 403
    system = client.get("/api/baum").json["kunden"][0]["systeme"][0]["id"]
    assert client.put(f"/api/objekte/system/{system}", json={"werte": {"KSOrt": "X"}}).status_code == 403
    # Techniker pflegen ISPs, Anlagen und Geräte selbst; Erstellt/Geändert wird mitgeschrieben
    isp = client.post("/api/objekte/isp", json={"eltern_id": system, "werte": {"ISName": "ISP Technik"}}).json["id"]
    anlage = client.post("/api/objekte/anlage", json={"eltern_id": isp, "werte": {"ANName": "RLT 9"}}).json["id"]
    gid = client.post("/api/objekte/geraet", json={"eltern_id": anlage, "werte": {"GRName": "Fühler"}}).json["id"]
    assert client.put(f"/api/objekte/geraet/{gid}", json={"werte": {"GRHersteller": "Siemens"}}).status_code == 200
    prot = client.get(f"/api/objekt-formular/geraet?id={gid}").json["protokoll"]
    name = f"{ich['vorname']} {ich['nachname']}".strip()
    assert prot["erstellt_von"] == name and prot["geaendert_von"] == name and prot["erstellt_am"]
    for typ, pk in (("geraet", gid), ("anlage", anlage), ("isp", isp)):
        assert client.delete(f"/api/objekte/{typ}/{pk}").status_code == 200, typ


def test_ausruestung(client):
    import io

    from PIL import Image

    fred = login(client, "FRF")
    stamm = client.get("/api/ausruestung/stammdaten").json
    assert stamm["darf_alles"] is False
    messgeraet = next(t for t in stamm["typen"] if t["kalibrierung"])
    meine = client.get("/api/ausruestung").json["eintraege"]
    assert meine and all(e["besitzer_id"] == fred["id"] for e in meine)
    assert len(client.get("/api/ausruestung?ansicht=alle").json["eintraege"]) > len(meine)

    assert client.post("/api/ausruestung", json={"name": "", "typ_id": messgeraet["id"]}).status_code == 400
    r = client.post("/api/ausruestung", json={"name": "Multimeter", "typ_id": messgeraet["id"], "hersteller": "Fluke",
                                               "naechste_pruefung": "2000-01-01", "besitzer_id": 1})
    assert r.status_code == 201, r.json
    auid = r.json["id"]
    d = client.get(f"/api/ausruestung/{auid}").json
    a = d["ausruestung"]
    assert a["besitzer_id"] == fred["id"] and a["pruefung"] == "faellig" and a["kalibrierpflichtig"] and d["darf_bearbeiten"]
    assert a["erstellt_von"]

    # Kalibrierung verschiebt die nächste Prüfung
    assert client.post(f"/api/ausruestung/{auid}/kalibrierungen", json={"datum": "2026-09-01", "gueltig_bis": "2026-08-01"}).status_code == 400
    assert client.post(f"/api/ausruestung/{auid}/kalibrierungen", json={"datum": "2026-09-01", "gueltig_bis": "2099-09-01", "ergebnis": "i. O."}).status_code == 200
    d = client.get(f"/api/ausruestung/{auid}").json
    assert d["ausruestung"]["naechste_pruefung"] == "2099-09-01" and d["ausruestung"]["pruefung"] is None
    assert client.delete(f"/api/kalibrierungen/{d['kalibrierungen'][0]['id']}").status_code == 200

    puffer = io.BytesIO()
    Image.new("RGB", (100, 80), "blue").save(puffer, "JPEG")
    puffer.seek(0)
    r = client.post(f"/api/ausruestung/{auid}/fotos", data={"fotos": (puffer, "geraet.jpg")}, content_type="multipart/form-data")
    assert r.status_code == 200, r.json
    assert len(client.get(f"/api/ausruestung/{auid}").json["fotos"]) == 1

    # Übergabe an Ralf, Ralf nimmt an
    client.post("/api/auth/logout")
    ralf = login(client, "RKO")
    client.post("/api/auth/logout")
    login(client, "FRF")
    assert client.post(f"/api/ausruestung/{auid}/uebergabe", json={"an_id": fred["id"]}).status_code == 400
    assert client.post(f"/api/ausruestung/{auid}/uebergabe", json={"an_id": ralf["id"], "notiz": "für Montag"}).status_code == 200
    assert client.post(f"/api/ausruestung/{auid}/uebergabe", json={"an_id": ralf["id"]}).status_code == 400
    uid = client.get(f"/api/ausruestung/{auid}").json["uebergaben"][0]["id"]
    assert client.post(f"/api/uebergaben/{uid}/annehmen").status_code == 403
    client.post("/api/auth/logout")
    login(client, "RKO")
    an_mich = client.get("/api/ausruestung").json["an_mich"]
    assert any(u["id"] == uid for u in an_mich)
    assert client.post(f"/api/uebergaben/{uid}/annehmen").status_code == 200
    assert client.post(f"/api/uebergaben/{uid}/annehmen").status_code == 409
    d = client.get(f"/api/ausruestung/{auid}").json
    assert d["ausruestung"]["besitzer_id"] == ralf["id"] and d["uebergaben"][0]["status"] == "angenommen"

    # Fred darf nicht mehr ändern, Admin kann den Besitzer direkt setzen
    client.post("/api/auth/logout")
    login(client, "FRF")
    assert client.put(f"/api/ausruestung/{auid}", json={"status": "reparatur"}).status_code == 403
    assert client.delete(f"/api/ausruestung/{auid}").status_code == 403
    client.post("/api/auth/logout")
    login(client, "RKO")
    assert client.put(f"/api/ausruestung/{auid}", json={"besitzer_id": fred["id"], "status": "ausgemustert"}).status_code == 200
    assert all(e["id"] != auid for e in client.get("/api/ausruestung?ansicht=alle").json["eintraege"])
    assert any(e["id"] == auid for e in client.get("/api/ausruestung?ansicht=alle&ausgemusterte=1").json["eintraege"])
    assert client.delete(f"/api/ausruestung/{auid}").status_code == 409  # hat ein Foto


def test_wartungsvorlagen_und_matrix(client):
    login(client, "RKO")
    d = client.get("/api/wartungsvorlagen").json
    assert d["darf_bearbeiten"] and len(d["vorlagen"]) >= 1 and d["luecken"]["anlagen_ohne_typ"] >= 0
    r = client.post("/api/wartungsvorlagen", json={"kurzbezeichnung": "Filter prüfen", "zeitvorgabe": "7,5", "gilt_fuer_geraete": True,
                                                   "vdma_position": "24186-1 2.3", "taetigkeit": "Inspektion"})
    assert r.status_code == 201, r.json
    v = r.json["vorlage"]
    assert (v["zeitvorgabe"], v["vdma_position"], v["taetigkeit"]) == (7.5, "24186-1 2.3", "Inspektion")
    assert client.post("/api/wartungsvorlagen", json={"kurzbezeichnung": "X"}).status_code == 400  # gilt für nichts
    art = d["geraetearten"][0]["id"]
    typ = d["anlagentypen"][0]["id"]
    assert client.put("/api/wartungsvorlagen/matrix/geraete", json={"vorlage_id": v["id"], "typ_id": art, "an": True}).status_code == 200
    assert client.put("/api/wartungsvorlagen/matrix/anlagen", json={"vorlage_id": v["id"], "typ_id": typ, "an": True}).status_code == 400
    assert [v["id"], art] in client.get("/api/wartungsvorlagen").json["matrix"]["geraete"]
    # gilt nicht mehr für Geräte: Häkchen fallen weg
    assert client.put(f"/api/wartungsvorlagen/{v['id']}", json={**v, "gilt_fuer_geraete": False, "gilt_fuer_anlagen": True}).status_code == 200
    assert [v["id"], art] not in client.get("/api/wartungsvorlagen").json["matrix"]["geraete"]
    assert client.delete(f"/api/wartungsvorlagen/{v['id']}").status_code == 200
    benutzt = next(x for x in d["vorlagen"] if x["verwendet"])
    assert client.delete(f"/api/wartungsvorlagen/{benutzt['id']}").status_code == 409

    l = client.get("/api/wartungsvorlagen/luecken").json
    if l["anlagen"]:
        r = client.post("/api/wartungsvorlagen/luecken", json={"anlagentypen": {str(l["anlagen"][0]["id"]): typ}})
        assert r.json["geaendert"] == 1

    client.post("/api/auth/logout")
    login(client, "FRF")
    assert client.get("/api/wartungsvorlagen").json["darf_bearbeiten"] is False
    assert client.post("/api/wartungsvorlagen", json={"kurzbezeichnung": "X", "gilt_fuer_geraete": True}).status_code == 403


def test_wartung_ablauf(client):
    login(client, "RKO")
    stamm = client.get("/api/auftraege/stammdaten").json
    wartung = next(t for t in stamm["typen"] if t["name"] == "Wartung")
    d = client.get("/api/wartungsvorlagen").json
    # System mit wartungspflichtigen Geräten suchen, deren Art eine Vorlage hat
    system = None
    for s in stamm["systeme"]:
        a = client.post("/api/auftraege", json={"name": "Wartung Test", "system_id": s["id"], "typ_id": wartung["id"], "status_id": 2}).json["auftrag"]
        v = client.get(f"/api/wartung/{a['id']}/vorschau").json
        if v["geraete"]["aufgaben"]:
            system = s
            break
    assert system, "kein System mit erzeugbaren Geräteaufgaben"
    atid = a["id"]
    assert v["status"] == "geplant" and v["vorhanden"] == 0
    assert any(x["id"] == atid for x in client.get("/api/wartung").json["auftraege"])  # erscheint auch ohne Aufgaben

    r = client.post(f"/api/wartung/{atid}/ausfuehren", json={"anlagen": False, "geraete": True})
    assert r.status_code == 200 and r.json["neu"] == v["geraete"]["aufgaben"]
    det = client.get(f"/api/wartung/{atid}").json
    assert det["auftrag"]["wartung_status"] == "gestartet" and det["auftrag"]["status"] == "in Arbeit"
    assert det["zeiten"]["soll_minuten"] >= 0
    assert all(t["geraet_id"] for t in det["aufgaben"])
    # erneut aktualisieren legt nichts doppelt an
    assert client.post(f"/api/wartung/{atid}/aufgaben-aktualisieren", json={"anlagen": False, "geraete": True}).json["neu"] == 0

    # Gerät nicht mehr wartungspflichtig: Aufgabe gilt als veraltet und lässt sich entfernen
    t = det["aufgaben"][0]
    client.put(f"/api/objekte/geraet/{t['geraet_id']}", json={"werte": {"GRWartungspflichtig": False}})
    veraltet = client.get(f"/api/wartung/{atid}").json["veraltet"]
    assert t["id"] in veraltet
    assert client.delete(f"/api/wartungsaufgaben/{t['id']}").status_code == 200
    client.put(f"/api/objekte/geraet/{t['geraet_id']}", json={"werte": {"GRWartungspflichtig": True}})
    assert client.post(f"/api/wartung/{atid}/aufgaben-aktualisieren", json={"anlagen": False, "geraete": True}).json["neu"] >= 1

    assert client.post(f"/api/wartung/{atid}/status", json={"status": "pausiert"}).status_code == 200
    assert client.get(f"/api/wartung/{atid}").json["auftrag"]["wartung_status"] == "pausiert"
    r = client.post(f"/api/wartung/{atid}/status", json={"status": "fertig"})
    assert r.status_code == 409 and "ohne Ergebnis" in r.json["message"]
    assert client.post(f"/api/wartung/{atid}/status", json={"status": "geplant"}).status_code == 409
    for aufgabe in client.get(f"/api/wartung/{atid}").json["aufgaben"]:
        assert client.post(f"/api/wartungsaufgaben/{aufgabe['id']}/ergebnis", json={"ergebnis": "gut"}).status_code == 200
    assert client.post(f"/api/wartung/{atid}/status", json={"status": "fertig"}).status_code == 200
    det = client.get(f"/api/wartung/{atid}").json
    assert det["auftrag"]["status"] == "erledigt"
    assert client.post(f"/api/wartung/{atid}/aufgaben-aktualisieren", json={}).status_code == 409
