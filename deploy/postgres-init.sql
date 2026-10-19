-- Run once, when the Postgres volume is first made. Search uses pg_trgm; in template1 every workspace's database
-- (made with create database) has it from the start. The migrations create it too.
create extension if not exists pg_trgm;
\c template1
create extension if not exists pg_trgm;
