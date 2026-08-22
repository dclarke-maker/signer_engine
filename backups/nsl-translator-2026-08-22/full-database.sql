--
-- PostgreSQL database dump
--

\restrict GQQEhWGPbct8h7w3KIXgrHgaEtVjVL3kAINCBtd3D4KMI4QkTJfrV4zMB6xzkMJ

-- Dumped from database version 16.14
-- Dumped by pg_dump version 16.14

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: corpus_sentences; Type: TABLE; Schema: public; Owner: nsl_user
--

CREATE TABLE public.corpus_sentences (
    id integer NOT NULL,
    sentence_id character varying(16) NOT NULL,
    english text NOT NULL,
    nepali text NOT NULL,
    category character varying(32) NOT NULL,
    difficulty character varying(16) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.corpus_sentences OWNER TO nsl_user;

--
-- Name: corpus_sentences_id_seq; Type: SEQUENCE; Schema: public; Owner: nsl_user
--

CREATE SEQUENCE public.corpus_sentences_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.corpus_sentences_id_seq OWNER TO nsl_user;

--
-- Name: corpus_sentences_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: nsl_user
--

ALTER SEQUENCE public.corpus_sentences_id_seq OWNED BY public.corpus_sentences.id;


--
-- Name: landmark_samples; Type: TABLE; Schema: public; Owner: nsl_user
--

CREATE TABLE public.landmark_samples (
    id integer NOT NULL,
    session_id integer NOT NULL,
    signer_id integer NOT NULL,
    sentence_id character varying(16) NOT NULL,
    category character varying(32),
    frames jsonb NOT NULL,
    nmm_tags jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.landmark_samples OWNER TO nsl_user;

--
-- Name: landmark_samples_id_seq; Type: SEQUENCE; Schema: public; Owner: nsl_user
--

CREATE SEQUENCE public.landmark_samples_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.landmark_samples_id_seq OWNER TO nsl_user;

--
-- Name: landmark_samples_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: nsl_user
--

ALTER SEQUENCE public.landmark_samples_id_seq OWNED BY public.landmark_samples.id;


--
-- Name: session_results; Type: TABLE; Schema: public; Owner: nsl_user
--

CREATE TABLE public.session_results (
    id integer NOT NULL,
    session_id integer NOT NULL,
    sentence_id character varying(16) NOT NULL,
    translated_text text,
    confidence numeric(4,3),
    feedback_rating character varying(16),
    correction text,
    modalities jsonb,
    nmm_tags jsonb,
    captured_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.session_results OWNER TO nsl_user;

--
-- Name: session_results_id_seq; Type: SEQUENCE; Schema: public; Owner: nsl_user
--

CREATE SEQUENCE public.session_results_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.session_results_id_seq OWNER TO nsl_user;

--
-- Name: session_results_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: nsl_user
--

ALTER SEQUENCE public.session_results_id_seq OWNED BY public.session_results.id;


--
-- Name: signers; Type: TABLE; Schema: public; Owner: nsl_user
--

CREATE TABLE public.signers (
    id integer NOT NULL,
    username character varying(64) NOT NULL,
    password_hash character varying(128) NOT NULL,
    display_name character varying(128) NOT NULL,
    role character varying(32) DEFAULT 'signer'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_login timestamp with time zone
);


ALTER TABLE public.signers OWNER TO nsl_user;

--
-- Name: signers_id_seq; Type: SEQUENCE; Schema: public; Owner: nsl_user
--

CREATE SEQUENCE public.signers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.signers_id_seq OWNER TO nsl_user;

--
-- Name: signers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: nsl_user
--

ALTER SEQUENCE public.signers_id_seq OWNED BY public.signers.id;


--
-- Name: signing_sessions; Type: TABLE; Schema: public; Owner: nsl_user
--

CREATE TABLE public.signing_sessions (
    id integer NOT NULL,
    signer_id integer NOT NULL,
    phase smallint DEFAULT 1 NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone
);


ALTER TABLE public.signing_sessions OWNER TO nsl_user;

--
-- Name: signing_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: nsl_user
--

CREATE SEQUENCE public.signing_sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.signing_sessions_id_seq OWNER TO nsl_user;

--
-- Name: signing_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: nsl_user
--

ALTER SEQUENCE public.signing_sessions_id_seq OWNED BY public.signing_sessions.id;


--
-- Name: corpus_sentences id; Type: DEFAULT; Schema: public; Owner: nsl_user
--

ALTER TABLE ONLY public.corpus_sentences ALTER COLUMN id SET DEFAULT nextval('public.corpus_sentences_id_seq'::regclass);


--
-- Name: landmark_samples id; Type: DEFAULT; Schema: public; Owner: nsl_user
--

ALTER TABLE ONLY public.landmark_samples ALTER COLUMN id SET DEFAULT nextval('public.landmark_samples_id_seq'::regclass);


--
-- Name: session_results id; Type: DEFAULT; Schema: public; Owner: nsl_user
--

ALTER TABLE ONLY public.session_results ALTER COLUMN id SET DEFAULT nextval('public.session_results_id_seq'::regclass);


--
-- Name: signers id; Type: DEFAULT; Schema: public; Owner: nsl_user
--

ALTER TABLE ONLY public.signers ALTER COLUMN id SET DEFAULT nextval('public.signers_id_seq'::regclass);


--
-- Name: signing_sessions id; Type: DEFAULT; Schema: public; Owner: nsl_user
--

ALTER TABLE ONLY public.signing_sessions ALTER COLUMN id SET DEFAULT nextval('public.signing_sessions_id_seq'::regclass);


--
-- Data for Name: corpus_sentences; Type: TABLE DATA; Schema: public; Owner: nsl_user
--

COPY public.corpus_sentences (id, sentence_id, english, nepali, category, difficulty, created_at) FROM stdin;
1	s01	My name is Ram.	मेरो नाम राम हो।	statement	easy	2026-06-22 04:42:54.988584+00
2	s02	I live in Kathmandu.	म काठमाडौंमा बस्छु।	statement	easy	2026-06-22 04:42:54.988584+00
3	s03	She is my sister.	उनी मेरी बहिनी हुन्।	statement	easy	2026-06-22 04:42:54.988584+00
4	s04	He works at a hospital.	उनी अस्पतालमा काम गर्छन्।	statement	medium	2026-06-22 04:42:54.988584+00
5	s05	The book is on the table.	किताब टेबलमा छ।	statement	easy	2026-06-22 04:42:54.988584+00
6	s06	Nepal is a beautiful country.	नेपाल एक सुन्दर देश हो।	statement	medium	2026-06-22 04:42:54.988584+00
7	s07	I am a student.	म एक विद्यार्थी हुँ।	statement	easy	2026-06-22 04:42:54.988584+00
8	s08	The weather is cold today.	आज मौसम चिसो छ।	statement	easy	2026-06-22 04:42:54.988584+00
9	s09	We are going to the market.	हामी बजार जाँदैछौं।	statement	medium	2026-06-22 04:42:54.988584+00
10	s10	The child is playing outside.	बच्चा बाहिर खेलिरहेको छ।	statement	medium	2026-06-22 04:42:54.988584+00
11	s11	My father is a teacher.	मेरो बुबा एक शिक्षक हुनुहुन्छ।	statement	easy	2026-06-22 04:42:54.988584+00
12	s12	The train arrives at noon.	रेल दिउँसो आउँछ।	statement	medium	2026-06-22 04:42:54.988584+00
13	s13	She likes to read books.	उनलाई किताब पढ्न मन पर्छ।	statement	medium	2026-06-22 04:42:54.988584+00
14	s14	The hospital is near the school.	अस्पताल स्कुलको नजिक छ।	statement	medium	2026-06-22 04:42:54.988584+00
15	s15	I have two brothers.	मेरो दुई भाइ छन्।	statement	easy	2026-06-22 04:42:54.988584+00
16	s16	The meeting starts at nine.	बैठक नौ बजे सुरु हुन्छ।	statement	medium	2026-06-22 04:42:54.988584+00
17	s17	This is my house.	यो मेरो घर हो।	statement	easy	2026-06-22 04:42:54.988584+00
18	s18	The food is very tasty.	खाना धेरै मिठो छ।	statement	easy	2026-06-22 04:42:54.988584+00
19	s19	They are good friends.	तिनीहरू राम्रा साथी हुन्।	statement	easy	2026-06-22 04:42:54.988584+00
20	s20	The river flows through the valley.	नदी उपत्यकाबाट बग्छ।	statement	hard	2026-06-22 04:42:54.988584+00
21	q01	What is your name?	तपाईंको नाम के हो?	question	easy	2026-06-22 04:42:54.988584+00
22	q02	Where do you live?	तपाईं कहाँ बस्नुहुन्छ?	question	easy	2026-06-22 04:42:54.988584+00
23	q03	How old are you?	तपाईंको उमेर कति हो?	question	easy	2026-06-22 04:42:54.988584+00
24	q04	What time is it?	अहिले कति बज्यो?	question	easy	2026-06-22 04:42:54.988584+00
25	q05	Are you feeling well?	तपाईं ठीक हुनुहुन्छ?	question	easy	2026-06-22 04:42:54.988584+00
26	q06	Where is the nearest hospital?	नजिकको अस्पताल कहाँ छ?	question	medium	2026-06-22 04:42:54.988584+00
27	q07	Can you help me?	के तपाईं मलाई सहयोग गर्न सक्नुहुन्छ?	question	medium	2026-06-22 04:42:54.988584+00
28	q08	What is the price of this?	यसको मूल्य कति हो?	question	medium	2026-06-22 04:42:54.988584+00
29	q09	Do you understand sign language?	के तपाईं सांकेतिक भाषा बुझ्नुहुन्छ?	question	hard	2026-06-22 04:42:54.988584+00
30	q10	Which bus goes to Thamel?	थमेल जाने बस कुन हो?	question	medium	2026-06-22 04:42:54.988584+00
31	q11	How far is the station?	स्टेशन कति टाढा छ?	question	medium	2026-06-22 04:42:54.988584+00
32	q12	Who is your doctor?	तपाईंको डाक्टर को हुनुहुन्छ?	question	easy	2026-06-22 04:42:54.988584+00
33	q13	What did you eat today?	तपाईंले आज के खानुभयो?	question	medium	2026-06-22 04:42:54.988584+00
34	q14	Is the market open now?	के बजार अहिले खुला छ?	question	medium	2026-06-22 04:42:54.988584+00
35	q15	When will you come back?	तपाईं कहिले फर्कनुहुन्छ?	question	medium	2026-06-22 04:42:54.988584+00
36	q16	Why are you crying?	तपाईं किन रुनुभएको?	question	medium	2026-06-22 04:42:54.988584+00
37	q17	How many people are there?	त्यहाँ कति मान्छे छन्?	question	medium	2026-06-22 04:42:54.988584+00
38	q18	What is your occupation?	तपाईंको पेशा के हो?	question	medium	2026-06-22 04:42:54.988584+00
39	q19	Can I sit here?	के म यहाँ बस्न सक्छु?	question	easy	2026-06-22 04:42:54.988584+00
40	q20	Do you have a pen?	के तपाईंसँग कलम छ?	question	easy	2026-06-22 04:42:54.988584+00
41	n01	I do not understand.	म बुझ्दिनँ।	negation	easy	2026-06-22 04:42:54.988584+00
42	n02	She is not here.	उनी यहाँ छैनन्।	negation	easy	2026-06-22 04:42:54.988584+00
43	n03	I do not want to go.	म जान चाहन्नँ।	negation	easy	2026-06-22 04:42:54.988584+00
44	n04	He did not eat anything.	उनले केही खाएनन्।	negation	medium	2026-06-22 04:42:54.988584+00
45	n05	This is not my bag.	यो मेरो झोला होइन।	negation	easy	2026-06-22 04:42:54.988584+00
46	n06	We cannot come tomorrow.	हामी भोलि आउन सक्दैनौं।	negation	medium	2026-06-22 04:42:54.988584+00
47	n07	I have no money.	मसँग पैसा छैन।	negation	easy	2026-06-22 04:42:54.988584+00
48	n08	The shop is not open.	पसल खुला छैन।	negation	easy	2026-06-22 04:42:54.988584+00
49	n09	She does not speak Nepali.	उनी नेपाली बोल्दिनन्।	negation	medium	2026-06-22 04:42:54.988584+00
50	n10	I am not sick.	म बिरामी छैन।	negation	easy	2026-06-22 04:42:54.988584+00
51	n11	He never comes on time.	उनी कहिल्यै समयमा आउँदैनन्।	negation	hard	2026-06-22 04:42:54.988584+00
52	n12	There is no water here.	यहाँ पानी छैन।	negation	easy	2026-06-22 04:42:54.988584+00
53	n13	I did not say that.	मैले त्यो भनेको होइन।	negation	medium	2026-06-22 04:42:54.988584+00
54	n14	They are not coming today.	तिनीहरू आज आउँदैनन्।	negation	medium	2026-06-22 04:42:54.988584+00
55	n15	This road is not safe.	यो बाटो सुरक्षित छैन।	negation	medium	2026-06-22 04:42:54.988584+00
56	n16	I cannot hear you.	म तपाईंको कुरा सुन्न सक्दिनँ।	negation	medium	2026-06-22 04:42:54.988584+00
57	n17	She has not arrived yet.	उनी अझै आइपुगेकी छैनन्।	negation	hard	2026-06-22 04:42:54.988584+00
58	n18	I do not know the address.	मलाई ठेगाना थाहा छैन।	negation	medium	2026-06-22 04:42:54.988584+00
59	n19	Nobody helped me.	कसैले मलाई सहयोग गरेन।	negation	hard	2026-06-22 04:42:54.988584+00
60	n20	The door is not locked.	ढोका बन्द छैन।	negation	easy	2026-06-22 04:42:54.988584+00
61	t01	I will come tomorrow.	म भोलि आउँछु।	temporal	easy	2026-06-22 04:42:54.988584+00
62	t02	She came yesterday.	उनी हिजो आइन्।	temporal	easy	2026-06-22 04:42:54.988584+00
63	t03	We met last week.	हामी गत हप्ता भेट्यौं।	temporal	medium	2026-06-22 04:42:54.988584+00
64	t04	The event is next month.	कार्यक्रम अर्को महिना छ।	temporal	medium	2026-06-22 04:42:54.988584+00
65	t05	I wake up at six every morning.	म हरेक बिहान छ बजे उठ्छु।	temporal	medium	2026-06-22 04:42:54.988584+00
66	t06	They will finish it by Friday.	तिनीहरू शुक्रबारसम्म सकाउँछन्।	temporal	hard	2026-06-22 04:42:54.988584+00
67	t07	It was raining two hours ago.	दुई घण्टा पहिले पानी परिरहेको थियो।	temporal	hard	2026-06-22 04:42:54.988584+00
68	t08	I have been waiting since morning.	म बिहानदेखि पर्खिरहेको छु।	temporal	hard	2026-06-22 04:42:54.988584+00
69	t09	She will call you soon.	उनी तपाईंलाई चाँडै फोन गर्छिन्।	temporal	medium	2026-06-22 04:42:54.988584+00
70	t10	The festival was last year.	चाड गत वर्ष थियो।	temporal	medium	2026-06-22 04:42:54.988584+00
71	t11	He left three days ago.	उनी तीन दिन पहिले गए।	temporal	medium	2026-06-22 04:42:54.988584+00
72	t12	I will finish this work by evening.	म यो काम साँझसम्म सकाउँछु।	temporal	medium	2026-06-22 04:42:54.988584+00
73	t13	We used to play here as children.	हामी बच्चाको बेला यहाँ खेल्थ्यौं।	temporal	hard	2026-06-22 04:42:54.988584+00
74	t14	The bus comes every hour.	बस हरेक घण्टामा आउँछ।	temporal	medium	2026-06-22 04:42:54.988584+00
75	t15	I will be back in five minutes.	म पाँच मिनेटमा फर्कन्छु।	temporal	medium	2026-06-22 04:42:54.988584+00
76	t16	She has been working here for two years.	उनी यहाँ दुई वर्षदेखि काम गर्दैछिन्।	temporal	hard	2026-06-22 04:42:54.988584+00
77	t17	The meeting was postponed to next week.	बैठक अर्को हप्तासम्म सारियो।	temporal	hard	2026-06-22 04:42:54.988584+00
78	t18	I always eat breakfast at eight.	म सधैं आठ बजे बिहानको खाना खान्छु।	temporal	medium	2026-06-22 04:42:54.988584+00
79	t19	They arrived just now.	तिनीहरू अहिलेमात्र आए।	temporal	easy	2026-06-22 04:42:54.988584+00
80	t20	The school opens in January.	स्कुल जनवरीमा खुल्छ।	temporal	medium	2026-06-22 04:42:54.988584+00
81	e01	Please give me water.	कृपया मलाई पानी दिनुस्।	everyday	easy	2026-06-22 04:42:54.988584+00
82	e02	Thank you very much.	धेरै धन्यवाद।	everyday	easy	2026-06-22 04:42:54.988584+00
83	e03	I am hungry.	मलाई भोक लागेको छ।	everyday	easy	2026-06-22 04:42:54.988584+00
84	e04	Please call a doctor.	कृपया डाक्टरलाई बोलाउनुस्।	everyday	medium	2026-06-22 04:42:54.988584+00
85	e05	I need help.	मलाई सहयोग चाहिन्छ।	everyday	easy	2026-06-22 04:42:54.988584+00
86	e06	Good morning.	शुभ प्रभात।	everyday	easy	2026-06-22 04:42:54.988584+00
87	e07	See you later.	पछि भेटौंला।	everyday	easy	2026-06-22 04:42:54.988584+00
88	e08	I am feeling tired.	मलाई थकान महसुस भइरहेको छ।	everyday	medium	2026-06-22 04:42:54.988584+00
89	e09	Please speak slowly.	कृपया बिस्तारै बोल्नुस्।	everyday	easy	2026-06-22 04:42:54.988584+00
90	e10	Where is the toilet?	शौचालय कहाँ छ?	everyday	easy	2026-06-22 04:42:54.988584+00
91	e11	I want to buy vegetables.	म तरकारी किन्न चाहन्छु।	everyday	medium	2026-06-22 04:42:54.988584+00
92	e12	Please write it down.	कृपया लेखिदिनुस्।	everyday	easy	2026-06-22 04:42:54.988584+00
93	e13	I am lost.	म हराएको छु।	everyday	easy	2026-06-22 04:42:54.988584+00
94	e14	This is too expensive.	यो धेरै महँगो छ।	everyday	medium	2026-06-22 04:42:54.988584+00
95	e15	I would like a receipt.	मलाई रसिद चाहिन्छ।	everyday	medium	2026-06-22 04:42:54.988584+00
96	e16	Please wait a moment.	कृपया एक क्षण पर्खनुस्।	everyday	easy	2026-06-22 04:42:54.988584+00
97	e17	I have a headache.	मेरो टाउको दुखिरहेको छ।	everyday	medium	2026-06-22 04:42:54.988584+00
98	e18	Can you repeat that?	के तपाईं फेरि भन्न सक्नुहुन्छ?	everyday	easy	2026-06-22 04:42:54.988584+00
99	e19	I am deaf.	म बहिरो हुँ।	everyday	easy	2026-06-22 04:42:54.988584+00
100	e20	Please use sign language.	कृपया सांकेतिक भाषा प्रयोग गर्नुस्।	everyday	medium	2026-06-22 04:42:54.988584+00
\.


--
-- Data for Name: landmark_samples; Type: TABLE DATA; Schema: public; Owner: nsl_user
--

COPY public.landmark_samples (id, session_id, signer_id, sentence_id, category, frames, nmm_tags, created_at) FROM stdin;
\.


--
-- Data for Name: session_results; Type: TABLE DATA; Schema: public; Owner: nsl_user
--

COPY public.session_results (id, session_id, sentence_id, translated_text, confidence, feedback_rating, correction, modalities, nmm_tags, captured_at) FROM stdin;
\.


--
-- Data for Name: signers; Type: TABLE DATA; Schema: public; Owner: nsl_user
--

COPY public.signers (id, username, password_hash, display_name, role, created_at, last_login) FROM stdin;
1	admin	$2a$10$RsPaAQZU1bvlINJ4BAYxTePteRFj04r3x5QYr1Rl3qc8GIOSykthy	Administrator	admin	2026-06-22 04:42:54.98705+00	\N
2	signer1	$2a$10$KSBY4sirkguIQutFLF1Yqe4wXEDoakdXmPDZ0rmrwbSJ5MdRNbRNy	Sita Sharma	signer	2026-06-22 04:42:54.98705+00	\N
3	researcher1	$2a$10$.O6taXACZQH2GCQqLrwlku5xs22zYHmlwbFRe4xdZtZQ3HEHphUu2	Dr. Ram Bahadur	researcher	2026-06-22 04:42:54.98705+00	2026-06-22 04:44:00.756616+00
\.


--
-- Data for Name: signing_sessions; Type: TABLE DATA; Schema: public; Owner: nsl_user
--

COPY public.signing_sessions (id, signer_id, phase, started_at, ended_at) FROM stdin;
\.


--
-- Name: corpus_sentences_id_seq; Type: SEQUENCE SET; Schema: public; Owner: nsl_user
--

SELECT pg_catalog.setval('public.corpus_sentences_id_seq', 100, true);


--
-- Name: landmark_samples_id_seq; Type: SEQUENCE SET; Schema: public; Owner: nsl_user
--

SELECT pg_catalog.setval('public.landmark_samples_id_seq', 1, false);


--
-- Name: session_results_id_seq; Type: SEQUENCE SET; Schema: public; Owner: nsl_user
--

SELECT pg_catalog.setval('public.session_results_id_seq', 1, false);


--
-- Name: signers_id_seq; Type: SEQUENCE SET; Schema: public; Owner: nsl_user
--

SELECT pg_catalog.setval('public.signers_id_seq', 3, true);


--
-- Name: signing_sessions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: nsl_user
--

SELECT pg_catalog.setval('public.signing_sessions_id_seq', 1, false);


--
-- Name: corpus_sentences corpus_sentences_pkey; Type: CONSTRAINT; Schema: public; Owner: nsl_user
--

ALTER TABLE ONLY public.corpus_sentences
    ADD CONSTRAINT corpus_sentences_pkey PRIMARY KEY (id);


--
-- Name: corpus_sentences corpus_sentences_sentence_id_key; Type: CONSTRAINT; Schema: public; Owner: nsl_user
--

ALTER TABLE ONLY public.corpus_sentences
    ADD CONSTRAINT corpus_sentences_sentence_id_key UNIQUE (sentence_id);


--
-- Name: landmark_samples landmark_samples_pkey; Type: CONSTRAINT; Schema: public; Owner: nsl_user
--

ALTER TABLE ONLY public.landmark_samples
    ADD CONSTRAINT landmark_samples_pkey PRIMARY KEY (id);


--
-- Name: session_results session_results_pkey; Type: CONSTRAINT; Schema: public; Owner: nsl_user
--

ALTER TABLE ONLY public.session_results
    ADD CONSTRAINT session_results_pkey PRIMARY KEY (id);


--
-- Name: signers signers_pkey; Type: CONSTRAINT; Schema: public; Owner: nsl_user
--

ALTER TABLE ONLY public.signers
    ADD CONSTRAINT signers_pkey PRIMARY KEY (id);


--
-- Name: signers signers_username_key; Type: CONSTRAINT; Schema: public; Owner: nsl_user
--

ALTER TABLE ONLY public.signers
    ADD CONSTRAINT signers_username_key UNIQUE (username);


--
-- Name: signing_sessions signing_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: nsl_user
--

ALTER TABLE ONLY public.signing_sessions
    ADD CONSTRAINT signing_sessions_pkey PRIMARY KEY (id);


--
-- Name: idx_corpus_category; Type: INDEX; Schema: public; Owner: nsl_user
--

CREATE INDEX idx_corpus_category ON public.corpus_sentences USING btree (category);


--
-- Name: idx_results_session; Type: INDEX; Schema: public; Owner: nsl_user
--

CREATE INDEX idx_results_session ON public.session_results USING btree (session_id);


--
-- Name: idx_samples_session; Type: INDEX; Schema: public; Owner: nsl_user
--

CREATE INDEX idx_samples_session ON public.landmark_samples USING btree (session_id);


--
-- Name: idx_samples_signer; Type: INDEX; Schema: public; Owner: nsl_user
--

CREATE INDEX idx_samples_signer ON public.landmark_samples USING btree (signer_id);


--
-- Name: idx_sessions_signer; Type: INDEX; Schema: public; Owner: nsl_user
--

CREATE INDEX idx_sessions_signer ON public.signing_sessions USING btree (signer_id);


--
-- Name: landmark_samples landmark_samples_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: nsl_user
--

ALTER TABLE ONLY public.landmark_samples
    ADD CONSTRAINT landmark_samples_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.signing_sessions(id) ON DELETE CASCADE;


--
-- Name: landmark_samples landmark_samples_signer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: nsl_user
--

ALTER TABLE ONLY public.landmark_samples
    ADD CONSTRAINT landmark_samples_signer_id_fkey FOREIGN KEY (signer_id) REFERENCES public.signers(id) ON DELETE CASCADE;


--
-- Name: session_results session_results_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: nsl_user
--

ALTER TABLE ONLY public.session_results
    ADD CONSTRAINT session_results_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.signing_sessions(id) ON DELETE CASCADE;


--
-- Name: signing_sessions signing_sessions_signer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: nsl_user
--

ALTER TABLE ONLY public.signing_sessions
    ADD CONSTRAINT signing_sessions_signer_id_fkey FOREIGN KEY (signer_id) REFERENCES public.signers(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict GQQEhWGPbct8h7w3KIXgrHgaEtVjVL3kAINCBtd3D4KMI4QkTJfrV4zMB6xzkMJ

