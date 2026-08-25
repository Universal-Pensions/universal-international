-- 0133_demo_id_cards.sql
-- ============================================================================
-- A pre-seeded pool of demo national ID cards, replacing the generated identity
-- the mock ID-OCR hands out.
--
-- WHY
-- ---
-- A11-002: the mock OCR used to return ONE constant NIN, so the second agent
-- onboarding ever attempted hit ux_subscribers_nin and 409'd permanently.
-- 0493e90c replaced it with a PRNG seeded on the wizard's sessionId, which
-- works — but it mints plausible-looking STRINGS, not coherent people, and it
-- models nothing. NIRA is a registry you look a citizen up in; drawing from a
-- curated table models that, hashing a session id does not.
--
-- ⚠️ THE PRNG IS NOT DELETED. api/kyc/id-ocr.ts falls back to it when this pool
-- is exhausted or unreachable. A demo that hard-fails on an empty pool would be
-- A11-002 all over again, which is the one outcome this must not reproduce.
--
-- WHAT A CARD CARRIES — AND WHAT IT DELIBERATELY DOES NOT
-- -------------------------------------------------------
-- Exactly the fields a Ugandan national ID card prints, because that is what an
-- OCR step can see: name, NIN, date of birth, sex, card number.
--   NO phone       — not on the card; typed by the rep (and verified: the phone
--                    is 100% manually entered in BOTH flows, ReviewStep.jsx:454)
--   NO district    — not on the card; picked from a combobox. id-ocr.ts:178-181
--                    already makes exactly this argument for itself
--   NO occupation  — not on the card; chosen from a <select>
-- Adding them would be dead columns that rot.
--
-- NIN FORMAT follows src/data/employerSeed.js's existing convention:
--   C + M|F + <2-digit age> + <2-digit birth month> + <8 alphanumerics> = 14
-- matching ReviewStep.jsx's NIN_RE = /^C[MF][A-Z0-9]{12}$/.
--
-- ⚠️ ux_subscribers_nin IS THE ONLY CONSTRAINT THAT BINDS HERE.
-- subscribers_phone_unique_non_demo_idx is partial on `is_demo_signup = FALSE`
-- and every signup stamps TRUE, so it never fires. There is no unique index on
-- email at all. Measured 2026-08-25: only 22 of 5,059 live subscribers carry a
-- NIN, which is precisely why this collision stayed hidden for so long — do not
-- read "no collisions today" as "collisions are impossible". The guard at the
-- foot of this migration asserts it against live rather than assuming it.
--
-- AGES are 22-55 at the 2026 anchor, so a static DOB has decades of headroom
-- before it could drift outside the [18,100] window the wizard and the
-- create_subscriber_* RPCs both enforce.
--
-- APPLIED VIA the Supabase migration API, which supplies its own transaction.
-- The BEGIN/COMMIT are the house convention for the psql path and are STRIPPED
-- before applying — Postgres transactions do not nest, and an inner COMMIT
-- commits the caller's. See scripts/psql-probe.sh.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.demo_id_cards (
  id                  TEXT PRIMARY KEY,
  nin                 TEXT NOT NULL UNIQUE
                        CHECK (nin ~ '^C[MF][A-Z0-9]{12}$'),
  first_name          TEXT NOT NULL,
  other_name          TEXT NOT NULL,
  last_name           TEXT NOT NULL,
  -- The old generator drew last_name and other_name from the SAME pool with no
  -- dedupe, so ~3.4% of mints produced a barcode reading NSUBUGA,FRANK,NSUBUGA.
  -- Encoded as a constraint so the pool cannot regress into it.
  CONSTRAINT demo_id_cards_distinct_names CHECK (
    first_name <> other_name AND last_name <> other_name AND first_name <> last_name),
  gender              TEXT NOT NULL CHECK (gender IN ('male', 'female')),
  dob                 DATE NOT NULL,
  card_number         TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'available'
                        CHECK (status IN ('available', 'claimed')),
  claimed_by_session  TEXT,
  claimed_at          TIMESTAMPTZ,
  -- Mirrors employer_invites (0047), whose own comment reads "one pending row
  -- per invited prospective member" — the same pending-identity -> claimed
  -- lifecycle, so the naming matches the house pattern.
  subscriber_id       TEXT REFERENCES public.subscribers(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT demo_id_cards_claim_coherent CHECK (
    (status = 'available' AND claimed_by_session IS NULL AND claimed_at IS NULL)
    OR (status = 'claimed' AND claimed_by_session IS NOT NULL AND claimed_at IS NOT NULL))
);

COMMENT ON TABLE public.demo_id_cards IS
  'Pre-seeded demo national ID cards claimed by api/kyc/id-ocr.ts (A11-002). Server-only: RLS on, no policies, by design.';

-- One session holds at most one card — this is what makes a retry return the
-- SAME person instead of minting a second one out from under the wizard.
CREATE UNIQUE INDEX IF NOT EXISTS ux_demo_id_cards_session
  ON public.demo_id_cards (claimed_by_session)
  WHERE claimed_by_session IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_demo_id_cards_available
  ON public.demo_id_cards (id) WHERE status = 'available';

-- ---------------------------------------------------------------------------
-- RLS: enabled, NO policies, client roles revoked.
-- Same posture 0127/0132 established for every non-client table. This is
-- REQUIRED, not decorative: 0132's standing guard fails any policy-less table
-- that anon or authenticated can read, so omitting it breaks the next migration
-- that runs. Only service_role (the Render route) reaches this table.
-- ---------------------------------------------------------------------------
ALTER TABLE public.demo_id_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.demo_id_cards FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.demo_id_cards FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- THE POOL — 200 cards, generated once and written literally so the diff is
-- reviewable and every environment is byte-identical. Authored in the style of
-- src/data/employerSeed.js MEMBERS, the one place in this repo that already
-- hand-writes realistic Ugandan identities with correctly-formatted NINs.
-- ---------------------------------------------------------------------------
INSERT INTO public.demo_id_cards
  (id, nin, first_name, other_name, last_name, gender, dob, card_number)
VALUES
  ('idc-0001', 'CM5311B72QXGJV', 'Bosco', 'Tumusiime', 'Otim', 'male', DATE '1973-11-04', 'UG4037510'),
  ('idc-0002', 'CM24028HY0EDIC', 'Godfrey', 'Kembabazi', 'Okiror', 'male', DATE '2002-02-03', 'UG2247809'),
  ('idc-0003', 'CF2611EYE5LI1M', 'Ruth', 'Kasozi', 'Nakato', 'female', DATE '2000-11-11', 'UG1401800'),
  ('idc-0004', 'CF30076QVAQ57C', 'Peace', 'Ekwaru', 'Mugisha', 'female', DATE '1996-07-11', 'UG2552929'),
  ('idc-0005', 'CM5409GYX61A39', 'Samuel', 'Natukunda', 'Tumusiime', 'male', DATE '1972-09-02', 'UG4795584'),
  ('idc-0006', 'CF26045PG9WQLQ', 'Stella', 'Nalwoga', 'Lamwaka', 'female', DATE '2000-04-09', 'UG8396536'),
  ('idc-0007', 'CF3002808MQLA7', 'Sylvia', 'Owori', 'Ssekandi', 'female', DATE '1996-02-24', 'UG8026543'),
  ('idc-0008', 'CM5412EQKC1HIF', 'Alex', 'Wandera', 'Namutebi', 'male', DATE '1972-12-14', 'UG8087335'),
  ('idc-0009', 'CF510582FZQR4G', 'Rose', 'Mugisha', 'Nalwoga', 'female', DATE '1975-05-13', 'UG1988827'),
  ('idc-0010', 'CM2608MDA64SAP', 'Wilson', 'Okello', 'Nsubuga', 'male', DATE '2000-08-21', 'UG4170120'),
  ('idc-0011', 'CM3505O03X7HX0', 'Fred', 'Opio', 'Namubiru', 'male', DATE '1991-05-05', 'UG6015236'),
  ('idc-0012', 'CF5510DJRNNSZJ', 'Annet', 'Musinguzi', 'Kembabazi', 'female', DATE '1971-10-27', 'UG2118046'),
  ('idc-0013', 'CF2709K7TK8MBY', 'Dorothy', 'Nabirye', 'Oceng', 'female', DATE '1999-09-20', 'UG8105145'),
  ('idc-0014', 'CF46015E4WA07U', 'Rose', 'Katusiime', 'Owori', 'female', DATE '1980-01-13', 'UG7027757'),
  ('idc-0015', 'CM3402YTU54B90', 'Robert', 'Arinaitwe', 'Otim', 'male', DATE '1992-02-08', 'UG1237021'),
  ('idc-0016', 'CM4202MCFR6IXK', 'Robert', 'Kyomuhendo', 'Arinaitwe', 'male', DATE '1984-02-15', 'UG7526456'),
  ('idc-0017', 'CF3203SIMCRAVV', 'Carol', 'Ojok', 'Aber', 'female', DATE '1994-03-03', 'UG4754150'),
  ('idc-0018', 'CM32108HK0HN7V', 'Ronald', 'Musinguzi', 'Mwesigwa', 'male', DATE '1994-10-27', 'UG7478083'),
  ('idc-0019', 'CF5311DT4UQSJU', 'Ruth', 'Okiror', 'Nabirye', 'female', DATE '1973-11-01', 'UG9455937'),
  ('idc-0020', 'CF4411QSUS03BE', 'Sandra', 'Ssekandi', 'Obua', 'female', DATE '1982-11-08', 'UG7763376'),
  ('idc-0021', 'CF2703L4ZW34RQ', 'Annet', 'Aber', 'Adong', 'female', DATE '1999-03-04', 'UG6266966'),
  ('idc-0022', 'CM3602O64J573A', 'Charles', 'Auma', 'Muhwezi', 'male', DATE '1990-02-08', 'UG5528146'),
  ('idc-0023', 'CM3307113SBA5K', 'Fred', 'Odongo', 'Ssempala', 'male', DATE '1993-07-28', 'UG5289358'),
  ('idc-0024', 'CF3803TNSDE0RS', 'Grace', 'Lubega', 'Kyomuhendo', 'female', DATE '1988-03-20', 'UG4714876'),
  ('idc-0025', 'CF2408IDMF39J9', 'Dorothy', 'Kyomuhendo', 'Ssentongo', 'female', DATE '2002-08-13', 'UG3015171'),
  ('idc-0026', 'CF5208JHOU7AW6', 'Florence', 'Akena', 'Kiiza', 'female', DATE '1974-08-09', 'UG6627686'),
  ('idc-0027', 'CM50091MTH5D49', 'John', 'Asiimwe', 'Ssempala', 'male', DATE '1976-09-04', 'UG1838673'),
  ('idc-0028', 'CM2209QMVFRXO6', 'Fred', 'Okiror', 'Namutebi', 'male', DATE '2004-09-19', 'UG7356748'),
  ('idc-0029', 'CM2202ZW55XOYT', 'Douglas', 'Lamwaka', 'Apio', 'male', DATE '2004-02-13', 'UG5391799'),
  ('idc-0030', 'CF46035GTUWNWE', 'Irene', 'Ekwaru', 'Kyomuhendo', 'female', DATE '1980-03-24', 'UG6371893'),
  ('idc-0031', 'CM4705DTGSIJD6', 'Julius', 'Wasswa', 'Odongo', 'male', DATE '1979-05-09', 'UG2058844'),
  ('idc-0032', 'CM2507SDEIJ5D2', 'Joseph', 'Wandera', 'Okiror', 'male', DATE '2001-07-24', 'UG5174024'),
  ('idc-0033', 'CF3506194RM0DE', 'Sarah', 'Nabirye', 'Byaruhanga', 'female', DATE '1991-06-11', 'UG8837539'),
  ('idc-0034', 'CM3304C5V2A921', 'Ivan', 'Nakimuli', 'Atuhaire', 'male', DATE '1993-04-27', 'UG8582473'),
  ('idc-0035', 'CM4012ZPUKJEXO', 'Martin', 'Nakimuli', 'Bwambale', 'male', DATE '1986-12-18', 'UG8061790'),
  ('idc-0036', 'CM2307OS9TABMV', 'Joseph', 'Masika', 'Lubega', 'male', DATE '2003-07-08', 'UG2621187'),
  ('idc-0037', 'CM2206X27UWDXO', 'Innocent', 'Ssekandi', 'Kato', 'male', DATE '2004-06-12', 'UG8731826'),
  ('idc-0038', 'CM47101LYCT7HR', 'Andrew', 'Akena', 'Masika', 'male', DATE '1979-10-21', 'UG6927940'),
  ('idc-0039', 'CF5510AITS9VXF', 'Cissy', 'Odongo', 'Nabukenya', 'female', DATE '1971-10-02', 'UG3035788'),
  ('idc-0040', 'CM4101LQ8QNC85', 'Ronald', 'Muhwezi', 'Masika', 'male', DATE '1985-01-03', 'UG4783990'),
  ('idc-0041', 'CF4612ZUHLI3F4', 'Florence', 'Kabuye', 'Okello', 'female', DATE '1980-12-03', 'UG9211725'),
  ('idc-0042', 'CM421050NY9CHQ', 'Samuel', 'Owori', 'Akello', 'male', DATE '1984-10-04', 'UG9550419'),
  ('idc-0043', 'CF3208Z83TLD5X', 'Barbara', 'Nabirye', 'Arinaitwe', 'female', DATE '1994-08-04', 'UG1502309'),
  ('idc-0044', 'CF23097A21T6P8', 'Irene', 'Byaruhanga', 'Ainembabazi', 'female', DATE '2003-09-23', 'UG3881359'),
  ('idc-0045', 'CM29077TPSX2KW', 'Wilson', 'Mukisa', 'Tumusiime', 'male', DATE '1997-07-06', 'UG8913281'),
  ('idc-0046', 'CM2907SMBNB6EQ', 'Henry', 'Babirye', 'Muhwezi', 'male', DATE '1997-07-08', 'UG8473785'),
  ('idc-0047', 'CM481012B9DF2C', 'Charles', 'Kato', 'Nalwoga', 'male', DATE '1978-10-23', 'UG1101299'),
  ('idc-0048', 'CF3109BVF8Q3D8', 'Esther', 'Atuhaire', 'Drazu', 'female', DATE '1995-09-22', 'UG9581668'),
  ('idc-0049', 'CF27059DCW0531', 'Sylvia', 'Lubega', 'Kiiza', 'female', DATE '1999-05-04', 'UG2122360'),
  ('idc-0050', 'CM45080N8Z5SRI', 'Denis', 'Nabukenya', 'Ainembabazi', 'male', DATE '1981-08-27', 'UG4149924'),
  ('idc-0051', 'CF41072P2JD8VM', 'Sarah', 'Amuge', 'Kembabazi', 'female', DATE '1985-07-03', 'UG8047054'),
  ('idc-0052', 'CF5101EE6DE89A', 'Grace', 'Akello', 'Katusiime', 'female', DATE '1975-01-27', 'UG7586618'),
  ('idc-0053', 'CF2912LEDP57S0', 'Dorothy', 'Etyang', 'Okiror', 'female', DATE '1997-12-20', 'UG2454589'),
  ('idc-0054', 'CF4001TRI31Z21', 'Norah', 'Auma', 'Adong', 'female', DATE '1986-01-03', 'UG4126481'),
  ('idc-0055', 'CF35124MKF9ROE', 'Peace', 'Turyahikayo', 'Drazu', 'female', DATE '1991-12-06', 'UG4302479'),
  ('idc-0056', 'CF4309ZU53QRIJ', 'Norah', 'Opio', 'Owori', 'female', DATE '1983-09-02', 'UG9752804'),
  ('idc-0057', 'CM5305RS8J3COV', 'Samuel', 'Ssentongo', 'Adong', 'male', DATE '1973-05-07', 'UG8206806'),
  ('idc-0058', 'CM5504IVA5JJHX', 'Wilson', 'Arinaitwe', 'Oceng', 'male', DATE '1971-04-27', 'UG5628904'),
  ('idc-0059', 'CF5411Z9S2LS54', 'Dorothy', 'Ssentongo', 'Auma', 'female', DATE '1972-11-21', 'UG4046323'),
  ('idc-0060', 'CF5105Z7J9O3ED', 'Carol', 'Nakimuli', 'Namubiru', 'female', DATE '1975-05-17', 'UG7668485'),
  ('idc-0061', 'CF3702F6GUK8UO', 'Mary', 'Wandera', 'Kato', 'female', DATE '1989-02-26', 'UG8077973'),
  ('idc-0062', 'CF3304DXJNILJD', 'Immaculate', 'Kabuye', 'Ssentongo', 'female', DATE '1993-04-04', 'UG7064367'),
  ('idc-0063', 'CF46086D436XPU', 'Florence', 'Atuhaire', 'Nabirye', 'female', DATE '1980-08-25', 'UG6003281'),
  ('idc-0064', 'CM2310NSN4QXD3', 'Peter', 'Mukisa', 'Kembabazi', 'male', DATE '2003-10-14', 'UG8700533'),
  ('idc-0065', 'CF5211NMNDWND3', 'Winnie', 'Okiror', 'Opio', 'female', DATE '1974-11-02', 'UG6814928'),
  ('idc-0066', 'CM3406TJPU191B', 'Eric', 'Natukunda', 'Rukundo', 'male', DATE '1992-06-27', 'UG9160128'),
  ('idc-0067', 'CF291074SCZ884', 'Diana', 'Kisakye', 'Lubega', 'female', DATE '1997-10-25', 'UG2279991'),
  ('idc-0068', 'CF4211087EWITC', 'Mary', 'Babirye', 'Arinaitwe', 'female', DATE '1984-11-08', 'UG2155610'),
  ('idc-0069', 'CF3607YKK58YOO', 'Betty', 'Natukunda', 'Kasozi', 'female', DATE '1990-07-14', 'UG4285014'),
  ('idc-0070', 'CF3408SOSI5H4B', 'Grace', 'Muhwezi', 'Lamwaka', 'female', DATE '1992-08-13', 'UG7428544'),
  ('idc-0071', 'CF4506ZAR6DQR3', 'Sylvia', 'Ekwaru', 'Nakimuli', 'female', DATE '1981-06-22', 'UG3627414'),
  ('idc-0072', 'CF530129BL8ZBY', 'Ruth', 'Nsubuga', 'Ssekandi', 'female', DATE '1973-01-22', 'UG2428490'),
  ('idc-0073', 'CM3405VG1LNRZR', 'Stephen', 'Namutebi', 'Ekwaru', 'male', DATE '1992-05-12', 'UG5334242'),
  ('idc-0074', 'CM3111G8D7MB1W', 'Simon', 'Natukunda', 'Namubiru', 'male', DATE '1995-11-16', 'UG3473128'),
  ('idc-0075', 'CM251268AIXV5A', 'Innocent', 'Natukunda', 'Ssentongo', 'male', DATE '2001-12-25', 'UG6650947'),
  ('idc-0076', 'CF2304EYEP8208', 'Sandra', 'Nakimuli', 'Otim', 'female', DATE '2003-04-16', 'UG9456019'),
  ('idc-0077', 'CF4004P9AE5X28', 'Irene', 'Adong', 'Nakimuli', 'female', DATE '1986-04-01', 'UG2378788'),
  ('idc-0078', 'CF3003GH941W3K', 'Mary', 'Ainembabazi', 'Aber', 'female', DATE '1996-03-15', 'UG9665308'),
  ('idc-0079', 'CF41121YSCQSXJ', 'Immaculate', 'Lamwaka', 'Okiror', 'female', DATE '1985-12-07', 'UG8895199'),
  ('idc-0080', 'CF3305W3SXB2EP', 'Esther', 'Apio', 'Nakimuli', 'female', DATE '1993-05-24', 'UG2050950'),
  ('idc-0081', 'CF2808YY7VRWYU', 'Norah', 'Mukisa', 'Aber', 'female', DATE '1998-08-18', 'UG3240840'),
  ('idc-0082', 'CM3307VORHQGU2', 'Stephen', 'Ainembabazi', 'Wasswa', 'male', DATE '1993-07-18', 'UG8070194'),
  ('idc-0083', 'CF5503RKCAPJN8', 'Sylvia', 'Atuhaire', 'Okello', 'female', DATE '1971-03-12', 'UG1048192'),
  ('idc-0084', 'CF5301JPWCC0AW', 'Prossy', 'Musinguzi', 'Otim', 'female', DATE '1973-01-13', 'UG7410019'),
  ('idc-0085', 'CM33060C0JOVAS', 'Simon', 'Opio', 'Byaruhanga', 'male', DATE '1993-06-03', 'UG5810104'),
  ('idc-0086', 'CM4112ODOY3DU3', 'Joseph', 'Okiror', 'Oceng', 'male', DATE '1985-12-05', 'UG8900189'),
  ('idc-0087', 'CF3005056MNSRK', 'Diana', 'Akena', 'Mukisa', 'female', DATE '1996-05-27', 'UG8714268'),
  ('idc-0088', 'CM39091DYGXYS1', 'Charles', 'Akena', 'Kisakye', 'male', DATE '1987-09-15', 'UG6502534'),
  ('idc-0089', 'CM410154MF0SBH', 'David', 'Odongo', 'Wasswa', 'male', DATE '1985-01-05', 'UG2401173'),
  ('idc-0090', 'CF5305EYJO2SSK', 'Agnes', 'Asiimwe', 'Oceng', 'female', DATE '1973-05-06', 'UG2662563'),
  ('idc-0091', 'CM49022S6T8TAR', 'Stephen', 'Okello', 'Amuge', 'male', DATE '1977-02-08', 'UG4722000'),
  ('idc-0092', 'CF4212O9M3SP0L', 'Irene', 'Kyomuhendo', 'Asiimwe', 'female', DATE '1984-12-21', 'UG7825088'),
  ('idc-0093', 'CF4712AQLKHHGQ', 'Carol', 'Babirye', 'Auma', 'female', DATE '1979-12-15', 'UG3352360'),
  ('idc-0094', 'CM4307DDYU0OXY', 'Vincent', 'Muhwezi', 'Kembabazi', 'male', DATE '1983-07-14', 'UG2038774'),
  ('idc-0095', 'CM30024XRJ17HI', 'Innocent', 'Auma', 'Nakimuli', 'male', DATE '1996-02-27', 'UG7829129'),
  ('idc-0096', 'CM23107AXA4BET', 'Nelson', 'Otim', 'Atuhaire', 'male', DATE '2003-10-13', 'UG4521010'),
  ('idc-0097', 'CF23045ELQWGC6', 'Carol', 'Muhwezi', 'Musinguzi', 'female', DATE '2003-04-06', 'UG1520929'),
  ('idc-0098', 'CF4802F59HI0JO', 'Dorothy', 'Okello', 'Kabuye', 'female', DATE '1978-02-03', 'UG3001858'),
  ('idc-0099', 'CM27029VGYT9HS', 'Ivan', 'Lubega', 'Etyang', 'male', DATE '1999-02-09', 'UG9070022'),
  ('idc-0100', 'CF4807MDEUEKLS', 'Phiona', 'Lamwaka', 'Kisakye', 'female', DATE '1978-07-03', 'UG8262345'),
  ('idc-0101', 'CF5209ZZI46K8T', 'Janet', 'Nalwoga', 'Apio', 'female', DATE '1974-09-08', 'UG1312177'),
  ('idc-0102', 'CM54045GS6SG3F', 'Andrew', 'Nakimuli', 'Ekwaru', 'male', DATE '1972-04-04', 'UG9622637'),
  ('idc-0103', 'CM4605VV2FJJV4', 'Bosco', 'Tumusiime', 'Katusiime', 'male', DATE '1980-05-02', 'UG4032716'),
  ('idc-0104', 'CM2612NUFR3GF8', 'Douglas', 'Amuge', 'Nankya', 'male', DATE '2000-12-14', 'UG5985232'),
  ('idc-0105', 'CM27057VAHGLRV', 'Patrick', 'Lubega', 'Drazu', 'male', DATE '1999-05-02', 'UG8908392'),
  ('idc-0106', 'CM3310BY8PJFOT', 'Emmanuel', 'Mugisha', 'Mwesigwa', 'male', DATE '1993-10-12', 'UG7487299'),
  ('idc-0107', 'CM47050524XJOP', 'Wilson', 'Kato', 'Nalwoga', 'male', DATE '1979-05-25', 'UG5052741'),
  ('idc-0108', 'CM30098ODENUVU', 'Robert', 'Babirye', 'Wandera', 'male', DATE '1996-09-24', 'UG6502922'),
  ('idc-0109', 'CM28019GCMVQJS', 'Innocent', 'Nabukenya', 'Ainembabazi', 'male', DATE '1998-01-25', 'UG4804449'),
  ('idc-0110', 'CF4909NBX7HI2Q', 'Rebecca', 'Nakimuli', 'Ainembabazi', 'female', DATE '1977-09-03', 'UG3795140'),
  ('idc-0111', 'CF3305GPLBPOCV', 'Rose', 'Opio', 'Otim', 'female', DATE '1993-05-24', 'UG9182732'),
  ('idc-0112', 'CF3712RKAYY5BL', 'Annet', 'Ssekandi', 'Akena', 'female', DATE '1989-12-24', 'UG5750724'),
  ('idc-0113', 'CF4202K7WYCSLC', 'Phiona', 'Aber', 'Mwesigwa', 'female', DATE '1984-02-04', 'UG8460607'),
  ('idc-0114', 'CM51098L75JF1I', 'Denis', 'Nsubuga', 'Nakimuli', 'male', DATE '1975-09-18', 'UG2553987'),
  ('idc-0115', 'CF3109YKUB2ZJ7', 'Joan', 'Mwesigwa', 'Mugisha', 'female', DATE '1995-09-10', 'UG1975688'),
  ('idc-0116', 'CM5404W0DPEER8', 'Joseph', 'Muhwezi', 'Mwesigwa', 'male', DATE '1972-04-24', 'UG5077410'),
  ('idc-0117', 'CF3103HJOGU88X', 'Peace', 'Kato', 'Nankya', 'female', DATE '1995-03-22', 'UG5845985'),
  ('idc-0118', 'CF3008GL1R7EPH', 'Ruth', 'Ssentongo', 'Etyang', 'female', DATE '1996-08-05', 'UG7437021'),
  ('idc-0119', 'CF5512UDZ9D9UU', 'Immaculate', 'Ekwaru', 'Namutebi', 'female', DATE '1971-12-20', 'UG5944683'),
  ('idc-0120', 'CM490429RUK4QD', 'Peter', 'Akena', 'Kasozi', 'male', DATE '1977-04-02', 'UG2183626'),
  ('idc-0121', 'CF2903AK5SKP9C', 'Grace', 'Tumusiime', 'Natukunda', 'female', DATE '1997-03-21', 'UG9871991'),
  ('idc-0122', 'CF4312Z933FVVQ', 'Justine', 'Apio', 'Etyang', 'female', DATE '1983-12-15', 'UG3425522'),
  ('idc-0123', 'CM4305J4CSK1S9', 'Gerald', 'Aber', 'Byaruhanga', 'male', DATE '1983-05-11', 'UG8844263'),
  ('idc-0124', 'CF2901I7I950XW', 'Winnie', 'Wasswa', 'Namutebi', 'female', DATE '1997-01-17', 'UG1698936'),
  ('idc-0125', 'CM2308YNIK7V8X', 'David', 'Nankya', 'Turyahikayo', 'male', DATE '2003-08-07', 'UG5702061'),
  ('idc-0126', 'CF4704E7MXRDOT', 'Sandra', 'Opio', 'Nsubuga', 'female', DATE '1979-04-05', 'UG9639092'),
  ('idc-0127', 'CM5111YP5C30KL', 'Bosco', 'Okiror', 'Nankya', 'male', DATE '1975-11-13', 'UG7170908'),
  ('idc-0128', 'CM36105LE3E6OH', 'David', 'Ojok', 'Mugisha', 'male', DATE '1990-10-18', 'UG5732177'),
  ('idc-0129', 'CF5510RYLTOHZS', 'Winnie', 'Muhwezi', 'Namubiru', 'female', DATE '1971-10-21', 'UG3245539'),
  ('idc-0130', 'CF2702W2CL739H', 'Sandra', 'Masika', 'Ssempala', 'female', DATE '1999-02-09', 'UG3240318'),
  ('idc-0131', 'CF3812PH62UBKJ', 'Annet', 'Adong', 'Kabuye', 'female', DATE '1988-12-15', 'UG9773977'),
  ('idc-0132', 'CM5108N15VR0ZT', 'Vincent', 'Ekwaru', 'Lubega', 'male', DATE '1975-08-08', 'UG7550786'),
  ('idc-0133', 'CF4602GXALVPTP', 'Peace', 'Mwesigwa', 'Nalwoga', 'female', DATE '1980-02-07', 'UG2927451'),
  ('idc-0134', 'CF4306BX7VRJS9', 'Rose', 'Wasswa', 'Rukundo', 'female', DATE '1983-06-28', 'UG8505260'),
  ('idc-0135', 'CF5102IX0R3NTL', 'Irene', 'Muhwezi', 'Tumusiime', 'female', DATE '1975-02-17', 'UG7675506'),
  ('idc-0136', 'CF4206E41G8PF6', 'Agnes', 'Okiror', 'Aber', 'female', DATE '1984-06-13', 'UG1388752'),
  ('idc-0137', 'CM4103OQ7BTGM7', 'Brian', 'Okello', 'Etyang', 'male', DATE '1985-03-02', 'UG4300112'),
  ('idc-0138', 'CF4902LMTWYILY', 'Janet', 'Obua', 'Kisakye', 'female', DATE '1977-02-28', 'UG1357412'),
  ('idc-0139', 'CM5412C4HT61OG', 'Emmanuel', 'Ssentongo', 'Kiiza', 'male', DATE '1972-12-02', 'UG6177445'),
  ('idc-0140', 'CM4509UBEFMN4N', 'Eric', 'Musinguzi', 'Otim', 'male', DATE '1981-09-07', 'UG3980137'),
  ('idc-0141', 'CM4405Z4KEWA8N', 'Denis', 'Kembabazi', 'Nabirye', 'male', DATE '1982-05-21', 'UG1711827'),
  ('idc-0142', 'CF5202MXB40UXG', 'Esther', 'Musinguzi', 'Adong', 'female', DATE '1974-02-10', 'UG7639452'),
  ('idc-0143', 'CF2510DSN21YOS', 'Sandra', 'Amuge', 'Ekwaru', 'female', DATE '2001-10-16', 'UG3057957'),
  ('idc-0144', 'CM3403C5RYYH0H', 'Moses', 'Namubiru', 'Nakato', 'male', DATE '1992-03-24', 'UG2819815'),
  ('idc-0145', 'CF3002FOCOB1QP', 'Rose', 'Lubega', 'Etyang', 'female', DATE '1996-02-06', 'UG9052840'),
  ('idc-0146', 'CM4006SD9EO2UX', 'Brian', 'Ekwaru', 'Kisakye', 'male', DATE '1986-06-03', 'UG6361141'),
  ('idc-0147', 'CF4308HCEVHCZX', 'Peace', 'Opio', 'Turyahikayo', 'female', DATE '1983-08-03', 'UG3496898'),
  ('idc-0148', 'CM32019DAGMYOA', 'Isaac', 'Mwesigwa', 'Namutebi', 'male', DATE '1994-01-08', 'UG8878288'),
  ('idc-0149', 'CM53049729HYHF', 'Ivan', 'Nabukenya', 'Kiiza', 'male', DATE '1973-04-18', 'UG3797730'),
  ('idc-0150', 'CF47101ABPC7J4', 'Irene', 'Adong', 'Akena', 'female', DATE '1979-10-09', 'UG1229960'),
  ('idc-0151', 'CF3812AF8LY2OH', 'Cissy', 'Okello', 'Apio', 'female', DATE '1988-12-02', 'UG4937302'),
  ('idc-0152', 'CF5009EIBFUFME', 'Norah', 'Muhwezi', 'Turyahikayo', 'female', DATE '1976-09-09', 'UG6370561'),
  ('idc-0153', 'CF4801Z2WWVCXT', 'Justine', 'Nalwoga', 'Otim', 'female', DATE '1978-01-12', 'UG6314133'),
  ('idc-0154', 'CF4310WHMXDISY', 'Dorothy', 'Wandera', 'Etyang', 'female', DATE '1983-10-09', 'UG7902344'),
  ('idc-0155', 'CF2301JJKZMZ28', 'Barbara', 'Kembabazi', 'Auma', 'female', DATE '2003-01-19', 'UG6417869'),
  ('idc-0156', 'CF3607WLATGYIN', 'Cissy', 'Ssentongo', 'Mwesigwa', 'female', DATE '1990-07-16', 'UG1093478'),
  ('idc-0157', 'CF3612GYECG1KB', 'Agnes', 'Wasswa', 'Bwambale', 'female', DATE '1990-12-09', 'UG7354295'),
  ('idc-0158', 'CF2906JRC8F346', 'Cissy', 'Drazu', 'Katusiime', 'female', DATE '1997-06-13', 'UG6849959'),
  ('idc-0159', 'CF5201NZXAYUV5', 'Ruth', 'Nakimuli', 'Mukisa', 'female', DATE '1974-01-06', 'UG2336759'),
  ('idc-0160', 'CF4903AG9U4IRP', 'Barbara', 'Apio', 'Atuhaire', 'female', DATE '1977-03-27', 'UG8136502'),
  ('idc-0161', 'CM54074LIBIB6J', 'Ronald', 'Obua', 'Katusiime', 'male', DATE '1972-07-14', 'UG4744897'),
  ('idc-0162', 'CM4501YU8N09CI', 'Bosco', 'Babirye', 'Mugisha', 'male', DATE '1981-01-14', 'UG1925404'),
  ('idc-0163', 'CM4409JO4YIRCE', 'Ronald', 'Katusiime', 'Ojok', 'male', DATE '1982-09-10', 'UG3092768'),
  ('idc-0164', 'CM2810S9M840EE', 'Wilson', 'Asiimwe', 'Owori', 'male', DATE '1998-10-14', 'UG5876010'),
  ('idc-0165', 'CF3411AHIZCQ4O', 'Brenda', 'Ssekandi', 'Kisakye', 'female', DATE '1992-11-20', 'UG9457397'),
  ('idc-0166', 'CM4009VMIE6TZ5', 'Stephen', 'Bwambale', 'Tumusiime', 'male', DATE '1986-09-08', 'UG9993638'),
  ('idc-0167', 'CF3603JWH6AXM0', 'Sandra', 'Nabirye', 'Tumusiime', 'female', DATE '1990-03-11', 'UG8928828'),
  ('idc-0168', 'CF26103WGE5SIQ', 'Justine', 'Auma', 'Kyomuhendo', 'female', DATE '2000-10-05', 'UG9545332'),
  ('idc-0169', 'CM4601NQARZK5U', 'Nelson', 'Kembabazi', 'Ssempala', 'male', DATE '1980-01-20', 'UG8756812'),
  ('idc-0170', 'CM2709QCIPX0O9', 'Richard', 'Oceng', 'Mugisha', 'male', DATE '1999-09-18', 'UG7609384'),
  ('idc-0171', 'CF400189LL7UZJ', 'Florence', 'Lubega', 'Atuhaire', 'female', DATE '1986-01-26', 'UG2714849'),
  ('idc-0172', 'CM3402XAZ39SJH', 'Frank', 'Kato', 'Mugisha', 'male', DATE '1992-02-25', 'UG1872310'),
  ('idc-0173', 'CF3903SKSMMQRX', 'Phiona', 'Namubiru', 'Mugisha', 'female', DATE '1987-03-15', 'UG9512771'),
  ('idc-0174', 'CM4411TVNEGITL', 'Frank', 'Kisakye', 'Turyahikayo', 'male', DATE '1982-11-04', 'UG2760267'),
  ('idc-0175', 'CM38114PLAFZRC', 'Ronald', 'Okello', 'Nsubuga', 'male', DATE '1988-11-23', 'UG4955035'),
  ('idc-0176', 'CF41051IO3VKJZ', 'Rose', 'Atuhaire', 'Adong', 'female', DATE '1985-05-27', 'UG7344703'),
  ('idc-0177', 'CM5110BAQPE6JL', 'Alex', 'Kyomuhendo', 'Nakato', 'male', DATE '1975-10-06', 'UG9569049'),
  ('idc-0178', 'CM4808011HJ6G5', 'Innocent', 'Nakimuli', 'Natukunda', 'male', DATE '1978-08-02', 'UG2644513'),
  ('idc-0179', 'CM2408MD3W8UDR', 'Julius', 'Tumusiime', 'Namubiru', 'male', DATE '2002-08-20', 'UG1321300'),
  ('idc-0180', 'CF3701H3Q5OIGK', 'Janet', 'Kiiza', 'Arinaitwe', 'female', DATE '1989-01-18', 'UG6692311'),
  ('idc-0181', 'CM3307TIT7HKMP', 'Joseph', 'Nabukenya', 'Asiimwe', 'male', DATE '1993-07-23', 'UG8506549'),
  ('idc-0182', 'CF4502BIRTI95D', 'Sarah', 'Bwambale', 'Muhwezi', 'female', DATE '1981-02-22', 'UG3906990'),
  ('idc-0183', 'CM5404LDTBM6K9', 'Stephen', 'Ainembabazi', 'Kyomuhendo', 'male', DATE '1972-04-15', 'UG4932903'),
  ('idc-0184', 'CF26087ZL53TCD', 'Florence', 'Kato', 'Okiror', 'female', DATE '2000-08-06', 'UG5738523'),
  ('idc-0185', 'CM50028VKB5V2C', 'Richard', 'Drazu', 'Musinguzi', 'male', DATE '1976-02-10', 'UG7605046'),
  ('idc-0186', 'CM4011K1P3X8IT', 'Denis', 'Kiiza', 'Kato', 'male', DATE '1986-11-18', 'UG7090835'),
  ('idc-0187', 'CF3405LU13P180', 'Norah', 'Kabuye', 'Ekwaru', 'female', DATE '1992-05-26', 'UG8953447'),
  ('idc-0188', 'CM4301SPX7SJI2', 'James', 'Tumusiime', 'Ssempala', 'male', DATE '1983-01-13', 'UG4777272'),
  ('idc-0189', 'CF2711YXKWDHWV', 'Winnie', 'Wasswa', 'Nabukenya', 'female', DATE '1999-11-24', 'UG1784580'),
  ('idc-0190', 'CM42124QSIT4S8', 'Eric', 'Wasswa', 'Arinaitwe', 'male', DATE '1984-12-01', 'UG4382818'),
  ('idc-0191', 'CF4908IZ59PUDS', 'Cissy', 'Masika', 'Lubega', 'female', DATE '1977-08-02', 'UG5515269'),
  ('idc-0192', 'CM24047SJFBQ5Y', 'Simon', 'Auma', 'Owori', 'male', DATE '2002-04-16', 'UG9462259'),
  ('idc-0193', 'CM46101U6NYPP1', 'Godfrey', 'Nankya', 'Kembabazi', 'male', DATE '1980-10-05', 'UG3122128'),
  ('idc-0194', 'CF45092Y5SBKZG', 'Irene', 'Turyahikayo', 'Mugisha', 'female', DATE '1981-09-10', 'UG1576331'),
  ('idc-0195', 'CF2411LOW6GA4G', 'Dorothy', 'Masika', 'Ssempala', 'female', DATE '2002-11-03', 'UG9275615'),
  ('idc-0196', 'CF4611AA8S4B1L', 'Justine', 'Okiror', 'Nakato', 'female', DATE '1980-11-14', 'UG3638718'),
  ('idc-0197', 'CF5201OC57Z0BQ', 'Sarah', 'Lamwaka', 'Wasswa', 'female', DATE '1974-01-23', 'UG5227118'),
  ('idc-0198', 'CM2402C57MIOXM', 'Moses', 'Drazu', 'Musinguzi', 'male', DATE '2002-02-23', 'UG4908999'),
  ('idc-0199', 'CF4606SYV4B3SX', 'Agnes', 'Nabirye', 'Tumusiime', 'female', DATE '1980-06-19', 'UG9108112'),
  ('idc-0200', 'CF2206QVMNYZE0', 'Harriet', 'Odongo', 'Aber', 'female', DATE '2004-06-27', 'UG5066485');


-- ---------------------------------------------------------------------------
-- claim_demo_id_card(p_session_id) — the only way a card leaves the pool.
--
-- Three behaviours, in order:
--   1. RETRY-STABLE. A session that already holds a card gets the SAME card
--      back. This is the one genuinely good property of the PRNG it replaces
--      and it has to survive: the wizard calls this stage more than once
--      ("Try again", a re-render), and must never swap the person mid-signup.
--   2. CLAIM THE NEXT FREE CARD, with FOR UPDATE SKIP LOCKED so two reps
--      demoing simultaneously cannot draw the same one. That concurrency case
--      is the whole reason this is a table and not a JSON file — a static file
--      has no shared claim state, which is exactly how A11-002 happened.
--   3. SELF-HEALING RECLAIM. A card claimed over 24h ago that never became a
--      subscriber was an abandoned wizard; free it. This avoids needing a
--      release call on reset, or a trigger on `subscribers`.
--
-- Returns NULL when genuinely exhausted — the caller falls back to the PRNG.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_demo_id_card(p_session_id TEXT)
RETURNS public.demo_id_cards
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  DECLARE
    v_card public.demo_id_cards;
  -- ⚠️ This block is INDENTED on purpose. scripts/psql-probe.sh --strip drops
  -- any column-0 line matching BEGIN/COMMIT/ROLLBACK/END followed by a
  -- semicolon. Un-indented, that would eat this function's own closing block
  -- delimiter and leave the dollar-quote dangling with "syntax error at end
  -- of input". Indenting keeps the file safe to dry-run.
  -- (And do NOT write the dollar-quote tag out in this comment — doing so
  --  closes the string right here. That mistake cost one dry-run.)
  BEGIN
    IF p_session_id IS NULL OR btrim(p_session_id) = '' THEN
      RETURN NULL;
    END IF;

  -- 1. Already held by this session?
  SELECT * INTO v_card
    FROM public.demo_id_cards
   WHERE claimed_by_session = p_session_id;
  IF FOUND THEN
    RETURN v_card;
  END IF;

  -- 3. Reclaim abandoned claims first, so a long-lived demo DB heals itself
  --    instead of slowly draining the pool.
  UPDATE public.demo_id_cards
     SET status = 'available', claimed_by_session = NULL, claimed_at = NULL
   WHERE status = 'claimed'
     AND subscriber_id IS NULL
     AND claimed_at < now() - INTERVAL '24 hours';

  -- 2. Claim the next free card.
  UPDATE public.demo_id_cards d
     SET status = 'claimed', claimed_by_session = p_session_id, claimed_at = now()
   WHERE d.id = (
     SELECT c.id FROM public.demo_id_cards c
      WHERE c.status = 'available'
      ORDER BY c.id
        FOR UPDATE SKIP LOCKED
      LIMIT 1)
  RETURNING * INTO v_card;

    RETURN v_card;  -- NULL when the pool is exhausted
  END;
$function$;

REVOKE ALL ON FUNCTION public.claim_demo_id_card(TEXT) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.claim_demo_id_card(TEXT) IS
  'Claims one demo ID card for a wizard session, retry-stable. Server-only (service_role); see api/kyc/id-ocr.ts.';

-- ---------------------------------------------------------------------------
-- GUARDS — measured, not assumed.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_n INT; v_bad TEXT[];
BEGIN
  SELECT count(*) INTO v_n FROM public.demo_id_cards;
  IF v_n <> 200 THEN
    RAISE EXCEPTION 'ABORT: expected 200 seeded cards, found %.', v_n USING ERRCODE = 'P0001';
  END IF;

  -- The one constraint that actually binds. If a seeded NIN already belongs to
  -- a subscriber, claiming that card would 409 on ux_subscribers_nin — the
  -- exact failure this migration exists to end.
  SELECT array_agg(c.nin) INTO v_bad
    FROM public.demo_id_cards c
   WHERE EXISTS (SELECT 1 FROM public.subscribers s WHERE s.nin = c.nin);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: % pool NIN(s) already exist on subscribers: %',
      array_length(v_bad, 1), array_to_string(v_bad, ', ') USING ERRCODE = 'P0001';
  END IF;

  -- Ages must sit inside the [18,100] window the wizard and the
  -- create_subscriber_* RPCs enforce, or a claimed card cannot complete signup.
  SELECT array_agg(id) INTO v_bad
    FROM public.demo_id_cards
   WHERE EXTRACT(YEAR FROM age(CURRENT_DATE, dob)) NOT BETWEEN 18 AND 100;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: card(s) outside the [18,100] age window: %',
      array_to_string(v_bad, ', ') USING ERRCODE = 'P0001';
  END IF;

  RAISE NOTICE 'guards OK — 200 cards, 0 NIN collisions with subscribers, all ages in range';
END $$;

COMMIT;
