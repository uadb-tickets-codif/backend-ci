--
-- PostgreSQL database dump
--

\restrict zI8HsyOGvBuYY99OGxeDThg4wgAF8aMcHJEA5ZMQgwZdtVbc4EpLz9dmYAmzfxi

-- Dumped from database version 16.16
-- Dumped by pg_dump version 16.16

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

--
-- Name: CodificationStatus; Type: TYPE; Schema: public; Owner: uadb
--

CREATE TYPE public."CodificationStatus" AS ENUM (
    'NOT_STARTED',
    'DOCUMENTS_SUBMITTED',
    'DOCUMENTS_APPROVED',
    'DOCUMENTS_REJECTED',
    'BED_SELECTED'
);


ALTER TYPE public."CodificationStatus" OWNER TO uadb;

--
-- Name: Gender; Type: TYPE; Schema: public; Owner: uadb
--

CREATE TYPE public."Gender" AS ENUM (
    'MALE',
    'FEMALE'
);


ALTER TYPE public."Gender" OWNER TO uadb;

--
-- Name: MealService; Type: TYPE; Schema: public; Owner: uadb
--

CREATE TYPE public."MealService" AS ENUM (
    'BREAKFAST',
    'LUNCH',
    'DINNER'
);


ALTER TYPE public."MealService" OWNER TO uadb;

--
-- Name: Role; Type: TYPE; Schema: public; Owner: uadb
--

CREATE TYPE public."Role" AS ENUM (
    'STUDENT',
    'CONTROLLER',
    'ADMIN'
);


ALTER TYPE public."Role" OWNER TO uadb;

--
-- Name: ScanResult; Type: TYPE; Schema: public; Owner: uadb
--

CREATE TYPE public."ScanResult" AS ENUM (
    'OK',
    'INSUFFICIENT_BALANCE',
    'ALREADY_SERVED',
    'INVALID_TOKEN',
    'TICKET_NOT_FOUND'
);


ALTER TYPE public."ScanResult" OWNER TO uadb;

--
-- Name: TicketStatus; Type: TYPE; Schema: public; Owner: uadb
--

CREATE TYPE public."TicketStatus" AS ENUM (
    'UNUSED',
    'USED',
    'EXPIRED'
);


ALTER TYPE public."TicketStatus" OWNER TO uadb;

--
-- Name: TransactionStatus; Type: TYPE; Schema: public; Owner: uadb
--

CREATE TYPE public."TransactionStatus" AS ENUM (
    'SUCCESS',
    'FAILED'
);


ALTER TYPE public."TransactionStatus" OWNER TO uadb;

--
-- Name: TransactionType; Type: TYPE; Schema: public; Owner: uadb
--

CREATE TYPE public."TransactionType" AS ENUM (
    'CREDIT',
    'DEBIT'
);


ALTER TYPE public."TransactionType" OWNER TO uadb;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: _prisma_migrations; Type: TABLE; Schema: public; Owner: uadb
--

CREATE TABLE public._prisma_migrations (
    id character varying(36) NOT NULL,
    checksum character varying(64) NOT NULL,
    finished_at timestamp with time zone,
    migration_name character varying(255) NOT NULL,
    logs text,
    rolled_back_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count integer DEFAULT 0 NOT NULL
);


ALTER TABLE public._prisma_migrations OWNER TO uadb;

--
-- Name: meal_scans; Type: TABLE; Schema: public; Owner: uadb
--

CREATE TABLE public.meal_scans (
    id text NOT NULL,
    student_id text,
    controller_id text NOT NULL,
    ticket_id text,
    service public."MealService" NOT NULL,
    date date NOT NULL,
    result public."ScanResult" NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.meal_scans OWNER TO uadb;

--
-- Name: tickets; Type: TABLE; Schema: public; Owner: uadb
--

CREATE TABLE public.tickets (
    id text NOT NULL,
    student_id text NOT NULL,
    service public."MealService" NOT NULL,
    status public."TicketStatus" DEFAULT 'UNUSED'::public."TicketStatus" NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    used_at timestamp(3) without time zone
);


ALTER TABLE public.tickets OWNER TO uadb;

--
-- Name: transactions; Type: TABLE; Schema: public; Owner: uadb
--

CREATE TABLE public.transactions (
    id text NOT NULL,
    wallet_id text NOT NULL,
    type public."TransactionType" NOT NULL,
    status public."TransactionStatus" DEFAULT 'SUCCESS'::public."TransactionStatus" NOT NULL,
    amount integer NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.transactions OWNER TO uadb;

--
-- Name: users; Type: TABLE; Schema: public; Owner: uadb
--

CREATE TABLE public.users (
    id text NOT NULL,
    student_number text,
    last_name text NOT NULL,
    first_name text NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    role public."Role" DEFAULT 'STUDENT'::public."Role" NOT NULL,
    gender public."Gender" NOT NULL,
    codification_status public."CodificationStatus" DEFAULT 'NOT_STARTED'::public."CodificationStatus" NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


ALTER TABLE public.users OWNER TO uadb;

--
-- Name: wallets; Type: TABLE; Schema: public; Owner: uadb
--

CREATE TABLE public.wallets (
    id text NOT NULL,
    user_id text NOT NULL,
    balance integer DEFAULT 0 NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


ALTER TABLE public.wallets OWNER TO uadb;

--
-- Data for Name: _prisma_migrations; Type: TABLE DATA; Schema: public; Owner: uadb
--

COPY public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) FROM stdin;
e66325ab-7130-483c-b9b4-9a2f8d135ccb	c8ac6b3c7e729d4218799b3e645a3cb5e655e0de764c6904bf1a3c0e48d14b40	2026-11-11 22:54:05.052487+00	20261109091050_add_auth_users	\N	\N	2026-11-11 22:54:05.008349+00	1
3868b631-6d78-4604-a14e-eb8d317845f9	36765614fee2f2f678b931fc861a3f8ca3fb6778f917d989d560e8d887d5a350	2026-11-11 22:54:05.137833+00	20261110174000_add_wallet_and_ticket_transactions	\N	\N	2026-11-11 22:54:05.056516+00	1
3088c986-cb58-40ce-be52-26815ad3e870	65c47e7031aa8c24f8b6c68365967bd09fde1b81ff4fe96b4dac799e07e167ef	2026-11-11 22:54:05.195729+00	20261110181400_add_qr_meal_scans	\N	\N	2026-11-11 22:54:05.142662+00	1
\.


--
-- Data for Name: meal_scans; Type: TABLE DATA; Schema: public; Owner: uadb
--

COPY public.meal_scans (id, student_id, controller_id, ticket_id, service, date, result, created_at) FROM stdin;
\.


--
-- Data for Name: tickets; Type: TABLE DATA; Schema: public; Owner: uadb
--

COPY public.tickets (id, student_id, service, status, created_at, used_at) FROM stdin;
\.


--
-- Data for Name: transactions; Type: TABLE DATA; Schema: public; Owner: uadb
--

COPY public.transactions (id, wallet_id, type, status, amount, created_at) FROM stdin;
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: uadb
--

COPY public.users (id, student_number, last_name, first_name, email, password_hash, role, gender, codification_status, created_at, updated_at) FROM stdin;
1d8fb822-a0da-4371-a3b0-021ac6c3fca1	1893264	NIASSE	Bocar	racob@gmail.com	$2b$12$egJnM/tpXoHfFgJ2foUrlelufP.lbuX5boe0DqOCpHsvUtz0LuSna	STUDENT	MALE	NOT_STARTED	2026-11-13 22:46:09.394	2026-11-13 22:46:09.394
dd97c980-84bd-44ab-84e7-9ecb9c846911	1193746	COLY	Junior	colylamine878@gmail.com	$2b$12$NpJWCOEvWgzGH0CPddDSPu8mWxOC2wU8nYHgZoep.j9csP7W9jL1u	STUDENT	MALE	NOT_STARTED	2026-11-14 23:21:16.657	2026-11-14 23:21:16.657
61cf6843-2ba2-4824-a0ff-bcc48ef849ce	2184657	BALDE	Samba	gladiateur@gmail.com	$2b$12$vZQs.5EDjJgnB.VmX5AmOODLKnZIE53vESUmA6t2ZN3akaAFsZ9yG	STUDENT	MALE	NOT_STARTED	2026-11-14 23:25:08.058	2026-11-14 23:25:08.058
\.


--
-- Data for Name: wallets; Type: TABLE DATA; Schema: public; Owner: uadb
--

COPY public.wallets (id, user_id, balance, updated_at) FROM stdin;
\.


--
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: uadb
--

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);


--
-- Name: meal_scans meal_scans_pkey; Type: CONSTRAINT; Schema: public; Owner: uadb
--

ALTER TABLE ONLY public.meal_scans
    ADD CONSTRAINT meal_scans_pkey PRIMARY KEY (id);


--
-- Name: tickets tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: uadb
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_pkey PRIMARY KEY (id);


--
-- Name: transactions transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: uadb
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: uadb
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: wallets wallets_pkey; Type: CONSTRAINT; Schema: public; Owner: uadb
--

ALTER TABLE ONLY public.wallets
    ADD CONSTRAINT wallets_pkey PRIMARY KEY (id);


--
-- Name: meal_scans_controller_id_created_at_idx; Type: INDEX; Schema: public; Owner: uadb
--

CREATE INDEX meal_scans_controller_id_created_at_idx ON public.meal_scans USING btree (controller_id, created_at);


--
-- Name: meal_scans_one_success_per_meal_day; Type: INDEX; Schema: public; Owner: uadb
--

CREATE UNIQUE INDEX meal_scans_one_success_per_meal_day ON public.meal_scans USING btree (student_id, service, date) WHERE ((result = 'OK'::public."ScanResult") AND (student_id IS NOT NULL));


--
-- Name: meal_scans_student_id_service_date_result_idx; Type: INDEX; Schema: public; Owner: uadb
--

CREATE INDEX meal_scans_student_id_service_date_result_idx ON public.meal_scans USING btree (student_id, service, date, result);


--
-- Name: tickets_student_id_status_idx; Type: INDEX; Schema: public; Owner: uadb
--

CREATE INDEX tickets_student_id_status_idx ON public.tickets USING btree (student_id, status);


--
-- Name: transactions_wallet_id_created_at_idx; Type: INDEX; Schema: public; Owner: uadb
--

CREATE INDEX transactions_wallet_id_created_at_idx ON public.transactions USING btree (wallet_id, created_at);


--
-- Name: users_email_key; Type: INDEX; Schema: public; Owner: uadb
--

CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email);


--
-- Name: users_student_number_key; Type: INDEX; Schema: public; Owner: uadb
--

CREATE UNIQUE INDEX users_student_number_key ON public.users USING btree (student_number);


--
-- Name: wallets_user_id_key; Type: INDEX; Schema: public; Owner: uadb
--

CREATE UNIQUE INDEX wallets_user_id_key ON public.wallets USING btree (user_id);


--
-- Name: meal_scans meal_scans_controller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: uadb
--

ALTER TABLE ONLY public.meal_scans
    ADD CONSTRAINT meal_scans_controller_id_fkey FOREIGN KEY (controller_id) REFERENCES public.users(id) ON UPDATE CASCADE;


--
-- Name: meal_scans meal_scans_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: uadb
--

ALTER TABLE ONLY public.meal_scans
    ADD CONSTRAINT meal_scans_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: meal_scans meal_scans_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: uadb
--

ALTER TABLE ONLY public.meal_scans
    ADD CONSTRAINT meal_scans_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(id) ON UPDATE CASCADE;


--
-- Name: tickets tickets_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: uadb
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: transactions transactions_wallet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: uadb
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_wallet_id_fkey FOREIGN KEY (wallet_id) REFERENCES public.wallets(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: wallets wallets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: uadb
--

ALTER TABLE ONLY public.wallets
    ADD CONSTRAINT wallets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict zI8HsyOGvBuYY99OGxeDThg4wgAF8aMcHJEA5ZMQgwZdtVbc4EpLz9dmYAmzfxi

