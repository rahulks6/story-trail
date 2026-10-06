-- Benchmark data only (a throwaway database): 100,000 people, ~1.5M follows, 2,000 live Stories.
-- Triggers are skipped while seeding (session_replication_role), as a bulk import would.
\timing on
SET session_replication_role = replica;
CREATE TEMP TABLE first_names AS SELECT unnest(ARRAY['rahul','priya','amit','sneha','arjun','ananya','vikram','kavya','rohan','isha','karan','meera','aditya','pooja','siddharth','neha','varun','divya','nikhil','riya','manish','shreya','akash','tanvi','yash','aisha','dev','sara','kabir','zara','ravi','anjali','suresh','lakshmi','arun','deepa','vivek','nisha','sanjay','asha','raj','maya','ishaan','tara','om','leela','jay','gita','harsh','uma']) AS name;
CREATE TEMP TABLE last_names AS SELECT unnest(ARRAY['sharma','verma','patel','reddy','iyer','nair','gupta','singh','kumar','das','menon','rao','joshi','shah','mehta','chopra','kapoor','malhotra','bose','sen','pillai','naidu','kulkarni','desai','pandey','mishra','yadav','jain','agarwal','bhat','ghosh','mukherjee','banerjee','chatterjee','dutta','saxena','tiwari','dubey','chauhan','thakur','rana','gill','sandhu','bajwa','sethi','anand','bhatia','khanna','arora','grover']) AS name;
CREATE TEMP TABLE vocab AS SELECT ARRAY['Travel','Food','Music','Photography','Cricket','Football','Movies','Books','Art','Fashion','Fitness','Yoga','Cooking','Gaming','Tech','Startups','Dance','Poetry','Hiking','Cycling','Running','Coffee','Tea','Pets','Dogs','Cats','Gardening','Design','Anime','Comedy','Bollywood','Theatre','History','Science','Space','Cars','Bikes','Sneakers','Makeup','Skincare','Beaches','Mountains','Street food','Biryani','Chai','Coding','AI','Finance','Crypto','Painting'] AS words;

INSERT INTO users (username, email, password_hash, display_name, interests_json, created_at, is_private)
SELECT f.name || '_' || l.name || '_' || g,
       'p' || g || '@perf.invalid', NULL,
       initcap(f.name) || ' ' || initcap(l.name),
       (SELECT coalesce(json_agg(v.words[1 + ((g * 31 + k * 7) % 50)]), '[]')::text FROM generate_series(1, g % 5) k),
       now() - ((g % 400) || ' days')::interval,
       g % 10 = 0
FROM generate_series(1, 100000) g
JOIN LATERAL (SELECT name FROM first_names OFFSET g % 50 LIMIT 1) f ON true
JOIN LATERAL (SELECT name FROM last_names OFFSET (g / 50) % 50 LIMIT 1) l ON true
CROSS JOIN vocab v;

CREATE TEMP TABLE numbered AS SELECT id, row_number() OVER (ORDER BY created_at, id) AS n FROM users;
CREATE INDEX ON numbered (n);
INSERT INTO follows (follower_id, followee_id, created_at)
SELECT DISTINCT ON (a.id, b.id) a.id, b.id, now() - (((a.n * 13 + k) % 300) || ' days')::interval
FROM numbered a
CROSS JOIN generate_series(1, 15) k
JOIN numbered b ON b.n = 1 + (a.n * 7 + k * 7919) % 100000
WHERE a.id <> b.id
ON CONFLICT DO NOTHING;

INSERT INTO media (owner_id, kind, mime_type, byte_size, storage_key)
SELECT id, 'photo', 'image/jpeg', 1000, 'perf/' || id FROM numbered WHERE n % 50 = 0;
INSERT INTO stories (owner_id, media_id, audience, expires_at)
SELECT m.owner_id, m.id, 'public', now() + interval '12 hours' FROM media m WHERE m.storage_key LIKE 'perf/%';
SET session_replication_role = origin;
ANALYZE;
SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM follows) AS follows, (SELECT count(*) FROM stories) AS stories;
