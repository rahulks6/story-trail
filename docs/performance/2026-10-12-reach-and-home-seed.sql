-- Benchmark data only (a throwaway database), Phase 9: the Phase 8 people seed (100,000 people,
-- ~1.5M follows), approximate areas around 30 cities (cells from the app's encoder), 10,000 live
-- public Stories at every reach stage, and ~300,000 Story views with engagement for the evaluator.
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


CREATE TEMP TABLE city_cells (n integer, cell text, tz text);
INSERT INTO city_cells VALUES (0, 'te7e', 'Asia/Calcutta'), (1, 'te7g', 'Asia/Calcutta'), (2, 'tek5', 'Asia/Calcutta'), (3, 'te7s', 'Asia/Calcutta'), (4, 'te7u', 'Asia/Calcutta'), (5, 'tekh', 'Asia/Calcutta'), (6, 'te7t', 'Asia/Calcutta'), (7, 'te7v', 'Asia/Calcutta'), (8, 'tekj', 'Asia/Calcutta'), (9, 'ttnd', 'Asia/Calcutta'), (10, 'ttnf', 'Asia/Calcutta'), (11, 'ttp4', 'Asia/Calcutta'), (12, 'ttne', 'Asia/Calcutta'), (13, 'ttng', 'Asia/Calcutta'), (14, 'ttp5', 'Asia/Calcutta'), (15, 'ttns', 'Asia/Calcutta'), (16, 'ttnu', 'Asia/Calcutta'), (17, 'ttph', 'Asia/Calcutta'), (18, 'tdqb', 'Asia/Calcutta'), (19, 'tdr0', 'Asia/Calcutta'), (20, 'tdr2', 'Asia/Calcutta'), (21, 'tdqc', 'Asia/Calcutta'), (22, 'tdr1', 'Asia/Calcutta'), (23, 'tdr3', 'Asia/Calcutta'), (24, 'tdqf', 'Asia/Calcutta'), (25, 'tdr4', 'Asia/Calcutta'), (26, 'tdr6', 'Asia/Calcutta'), (27, 'tep9', 'Asia/Calcutta'), (28, 'tepc', 'Asia/Calcutta'), (29, 'tg01', 'Asia/Calcutta'), (30, 'tepd', 'Asia/Calcutta'), (31, 'tepf', 'Asia/Calcutta'), (32, 'tg04', 'Asia/Calcutta'), (33, 'tepe', 'Asia/Calcutta'), (34, 'tepg', 'Asia/Calcutta'), (35, 'tg05', 'Asia/Calcutta'), (36, 'ts53', 'Asia/Calcutta'), (37, 'ts59', 'Asia/Calcutta'), (38, 'ts5c', 'Asia/Calcutta'), (39, 'ts56', 'Asia/Calcutta'), (40, 'ts5d', 'Asia/Calcutta'), (41, 'ts5f', 'Asia/Calcutta'), (42, 'ts57', 'Asia/Calcutta'), (43, 'ts5e', 'Asia/Calcutta'), (44, 'ts5g', 'Asia/Calcutta'), (45, 'tf2c', 'Asia/Calcutta'), (46, 'tf31', 'Asia/Calcutta'), (47, 'tf33', 'Asia/Calcutta'), (48, 'tf2f', 'Asia/Calcutta'), (49, 'tf34', 'Asia/Calcutta'), (50, 'tf36', 'Asia/Calcutta'), (51, 'tf2g', 'Asia/Calcutta'), (52, 'tf35', 'Asia/Calcutta'), (53, 'tf37', 'Asia/Calcutta'), (54, 'tgyx', 'Asia/Calcutta'), (55, 'tgyz', 'Asia/Calcutta'), (56, 'tgzp', 'Asia/Calcutta'), (57, 'tun8', 'Asia/Calcutta'), (58, 'tunb', 'Asia/Calcutta'), (59, 'tup0', 'Asia/Calcutta'), (60, 'tun9', 'Asia/Calcutta'), (61, 'tunc', 'Asia/Calcutta'), (62, 'tup1', 'Asia/Calcutta'), (63, 'tek2', 'Asia/Calcutta'), (64, 'tek8', 'Asia/Calcutta'), (65, 'tekb', 'Asia/Calcutta'), (66, 'tek3', 'Asia/Calcutta'), (67, 'tek9', 'Asia/Calcutta'), (68, 'tekc', 'Asia/Calcutta'), (69, 'tek6', 'Asia/Calcutta'), (70, 'tekd', 'Asia/Calcutta'), (71, 'tekf', 'Asia/Calcutta'), (72, 'tsv8', 'Asia/Calcutta'), (73, 'tsvb', 'Asia/Calcutta'), (74, 'tsy0', 'Asia/Calcutta'), (75, 'tsv9', 'Asia/Calcutta'), (76, 'tsvc', 'Asia/Calcutta'), (77, 'tsy1', 'Asia/Calcutta'), (78, 'tsvd', 'Asia/Calcutta'), (79, 'tsvf', 'Asia/Calcutta'), (80, 'tsy4', 'Asia/Calcutta'), (81, 'tu9r', 'Asia/Calcutta'), (82, 'tu9x', 'Asia/Calcutta'), (83, 'tu9z', 'Asia/Calcutta'), (84, 'tuc2', 'Asia/Calcutta'), (85, 'tuc8', 'Asia/Calcutta'), (86, 'tucb', 'Asia/Calcutta'), (87, 'tuc3', 'Asia/Calcutta'), (88, 'tuc9', 'Asia/Calcutta'), (89, 'tucc', 'Asia/Calcutta'), (90, 'tu8v', 'Asia/Calcutta'), (91, 'tu9j', 'Asia/Calcutta'), (92, 'tu9m', 'Asia/Calcutta'), (93, 'tu8y', 'Asia/Calcutta'), (94, 'tu9n', 'Asia/Calcutta'), (95, 'tu9q', 'Asia/Calcutta'), (96, 'tu8z', 'Asia/Calcutta'), (97, 'tu9p', 'Asia/Calcutta'), (98, 'tu9r', 'Asia/Calcutta'), (99, 'texz', 'Asia/Calcutta'), (100, 'tg8p', 'Asia/Calcutta'), (101, 'tg8r', 'Asia/Calcutta'), (102, 'tezb', 'Asia/Calcutta'), (103, 'tgb0', 'Asia/Calcutta'), (104, 'tgb2', 'Asia/Calcutta'), (105, 'tezc', 'Asia/Calcutta'), (106, 'tgb1', 'Asia/Calcutta'), (107, 'tgb3', 'Asia/Calcutta'), (108, 'tsj8', 'Asia/Calcutta'), (109, 'tsjb', 'Asia/Calcutta'), (110, 'tsn0', 'Asia/Calcutta'), (111, 'tsj9', 'Asia/Calcutta'), (112, 'tsjc', 'Asia/Calcutta'), (113, 'tsn1', 'Asia/Calcutta'), (114, 'tsjd', 'Asia/Calcutta'), (115, 'tsjf', 'Asia/Calcutta'), (116, 'tsn4', 'Asia/Calcutta'), (117, 'tsng', 'Asia/Calcutta'), (118, 'tsp5', 'Asia/Calcutta'), (119, 'tsp7', 'Asia/Calcutta'), (120, 'tsnu', 'Asia/Calcutta'), (121, 'tsph', 'Asia/Calcutta'), (122, 'tspk', 'Asia/Calcutta'), (123, 'tsnv', 'Asia/Calcutta'), (124, 'tspj', 'Asia/Calcutta'), (125, 'tspm', 'Asia/Calcutta'), (126, 'tus2', 'Asia/Calcutta'), (127, 'tus8', 'Asia/Calcutta'), (128, 'tusb', 'Asia/Calcutta'), (129, 'tus3', 'Asia/Calcutta'), (130, 'tus9', 'Asia/Calcutta'), (131, 'tusc', 'Asia/Calcutta'), (132, 'tus6', 'Asia/Calcutta'), (133, 'tusd', 'Asia/Calcutta'), (134, 'tusf', 'Asia/Calcutta'), (135, 'tegv', 'Asia/Calcutta'), (136, 'teuj', 'Asia/Calcutta'), (137, 'teum', 'Asia/Calcutta'), (138, 'tegy', 'Asia/Calcutta'), (139, 'teun', 'Asia/Calcutta'), (140, 'teuq', 'Asia/Calcutta'), (141, 'tegz', 'Asia/Calcutta'), (142, 'teup', 'Asia/Calcutta'), (143, 'teur', 'Asia/Calcutta'), (144, 'teex', 'Asia/Calcutta'), (145, 'teez', 'Asia/Calcutta'), (146, 'tesp', 'Asia/Calcutta'), (147, 'teg8', 'Asia/Calcutta'), (148, 'tegb', 'Asia/Calcutta'), (149, 'teu0', 'Asia/Calcutta'), (150, 'teg9', 'Asia/Calcutta'), (151, 'tegc', 'Asia/Calcutta'), (152, 'teu1', 'Asia/Calcutta'), (153, 't9tz', 'Asia/Calcutta'), (154, 't9wp', 'Asia/Calcutta'), (155, 't9wr', 'Asia/Calcutta'), (156, 't9vb', 'Asia/Calcutta'), (157, 't9y0', 'Asia/Calcutta'), (158, 't9y2', 'Asia/Calcutta'), (159, 't9vc', 'Asia/Calcutta'), (160, 't9y1', 'Asia/Calcutta'), (161, 't9y3', 'Asia/Calcutta'), (162, 'ttqm', 'Asia/Calcutta'), (163, 'ttqt', 'Asia/Calcutta'), (164, 'ttqv', 'Asia/Calcutta'), (165, 'ttqq', 'Asia/Calcutta'), (166, 'ttqw', 'Asia/Calcutta'), (167, 'ttqy', 'Asia/Calcutta'), (168, 'ttqr', 'Asia/Calcutta'), (169, 'ttqx', 'Asia/Calcutta'), (170, 'ttqz', 'Asia/Calcutta'), (171, 'wh8g', 'Asia/Calcutta'), (172, 'wh95', 'Asia/Calcutta'), (173, 'wh97', 'Asia/Calcutta'), (174, 'wh8u', 'Asia/Calcutta'), (175, 'wh9h', 'Asia/Calcutta'), (176, 'wh9k', 'Asia/Calcutta'), (177, 'wh8v', 'Asia/Calcutta'), (178, 'wh9j', 'Asia/Calcutta'), (179, 'wh9m', 'Asia/Calcutta'), (180, 'thrn', 'Asia/Dubai'), (181, 'thrq', 'Asia/Dubai'), (182, 'thrw', 'Asia/Dubai'), (183, 'thrp', 'Asia/Dubai'), (184, 'thrr', 'Asia/Dubai'), (185, 'thrx', 'Asia/Dubai'), (186, 'thx0', 'Asia/Dubai'), (187, 'thx2', 'Asia/Dubai'), (188, 'thx8', 'Asia/Dubai'), (189, 'gcps', 'Europe/London'), (190, 'gcpu', 'Europe/London'), (191, 'u10h', 'Europe/London'), (192, 'gcpt', 'Europe/London'), (193, 'gcpv', 'Europe/London'), (194, 'u10j', 'Europe/London'), (195, 'gcpw', 'Europe/London'), (196, 'gcpy', 'Europe/London'), (197, 'u10n', 'Europe/London'), (198, 'dr5n', 'America/New_York'), (199, 'dr5q', 'America/New_York'), (200, 'dr5w', 'America/New_York'), (201, 'dr5p', 'America/New_York'), (202, 'dr5r', 'America/New_York'), (203, 'dr5x', 'America/New_York'), (204, 'dr70', 'America/New_York'), (205, 'dr72', 'America/New_York'), (206, 'dr78', 'America/New_York'), (207, 'dpxr', 'America/Toronto'), (208, 'dpxx', 'America/Toronto'), (209, 'dpxz', 'America/Toronto'), (210, 'dpz2', 'America/Toronto'), (211, 'dpz8', 'America/Toronto'), (212, 'dpzb', 'America/Toronto'), (213, 'dpz3', 'America/Toronto'), (214, 'dpz9', 'America/Toronto'), (215, 'dpzc', 'America/Toronto'), (216, 'w21w', 'Asia/Singapore'), (217, 'w21y', 'Asia/Singapore'), (218, 'w24n', 'Asia/Singapore'), (219, 'w21x', 'Asia/Singapore'), (220, 'w21z', 'Asia/Singapore'), (221, 'w24p', 'Asia/Singapore'), (222, 'w238', 'Asia/Singapore'), (223, 'w23b', 'Asia/Singapore'), (224, 'w260', 'Asia/Singapore'), (225, 'r3gq', 'Australia/Sydney'), (226, 'r3gw', 'Australia/Sydney'), (227, 'r3gy', 'Australia/Sydney'), (228, 'r3gr', 'Australia/Sydney'), (229, 'r3gx', 'Australia/Sydney'), (230, 'r3gz', 'Australia/Sydney'), (231, 'r652', 'Australia/Sydney'), (232, 'r658', 'Australia/Sydney'), (233, 'r65b', 'Australia/Sydney'), (234, 'u333', 'Europe/Berlin'), (235, 'u339', 'Europe/Berlin'), (236, 'u33c', 'Europe/Berlin'), (237, 'u336', 'Europe/Berlin'), (238, 'u33d', 'Europe/Berlin'), (239, 'u33f', 'Europe/Berlin'), (240, 'u337', 'Europe/Berlin'), (241, 'u33e', 'Europe/Berlin'), (242, 'u33g', 'Europe/Berlin'), (243, 'wh0n', 'Asia/Dhaka'), (244, 'wh0q', 'Asia/Dhaka'), (245, 'wh0w', 'Asia/Dhaka'), (246, 'wh0p', 'Asia/Dhaka'), (247, 'wh0r', 'Asia/Dhaka'), (248, 'wh0x', 'Asia/Dhaka'), (249, 'wh20', 'Asia/Dhaka'), (250, 'wh22', 'Asia/Dhaka'), (251, 'wh28', 'Asia/Dhaka'), (252, 'tuuk', 'Asia/Katmandu'), (253, 'tuus', 'Asia/Katmandu'), (254, 'tuuu', 'Asia/Katmandu'), (255, 'tuum', 'Asia/Katmandu'), (256, 'tuut', 'Asia/Katmandu'), (257, 'tuuv', 'Asia/Katmandu'), (258, 'tuuq', 'Asia/Katmandu'), (259, 'tuuw', 'Asia/Katmandu'), (260, 'tuuy', 'Asia/Katmandu'), (261, '9q8t', 'America/Los_Angeles'), (262, '9q8v', 'America/Los_Angeles'), (263, '9q9j', 'America/Los_Angeles'), (264, '9q8w', 'America/Los_Angeles'), (265, '9q8y', 'America/Los_Angeles'), (266, '9q9n', 'America/Los_Angeles'), (267, '9q8x', 'America/Los_Angeles'), (268, '9q8z', 'America/Los_Angeles'), (269, '9q9p', 'America/Los_Angeles');
-- 80% share an area; a quarter of those only a time zone (Nearby Stories off).
INSERT INTO user_areas (user_id, cell, time_zone, updated_at)
SELECT u.id, CASE WHEN u.n % 4 = 0 THEN NULL ELSE c.cell END, c.tz, now() - ((u.n % 20) || ' days')::interval
FROM numbered u JOIN city_cells c ON c.n = u.n % 270
WHERE u.n % 5 <> 0;

INSERT INTO media (owner_id, kind, mime_type, byte_size, storage_key)
SELECT id, 'photo', 'image/jpeg', 1000, 'perf/' || id FROM numbered WHERE n % 10 = 1;
INSERT INTO stories (owner_id, media_id, audience, created_at, expires_at)
SELECT m.owner_id, m.id, 'public', t.created, t.created + interval '24 hours'
FROM media m CROSS JOIN LATERAL (SELECT now() - ((abs(hashtext(m.id::text)) % 1200) || ' minutes')::interval AS created) t
WHERE m.storage_key LIKE 'perf/%';
CREATE TEMP TABLE live AS SELECT id, owner_id, created_at, row_number() OVER (ORDER BY id) AS n FROM stories;

-- Reach: half at stage 1, then fewer at each wider stage; 1 in 20 held; 1 in 10 not judged yet.
INSERT INTO story_reach (story_id, stage, held, stage_started_at, stage_impressions, evaluated_at)
SELECT id, st.stage, n % 20 = 7, created_at + interval '20 minutes',
       CASE st.stage WHEN 1 THEN n % 50 WHEN 2 THEN n % 300 WHEN 3 THEN n % 2000 ELSE 0 END,
       now() - ((n % 600) || ' seconds')::interval
FROM live CROSS JOIN LATERAL (SELECT CASE WHEN n % 10 < 5 THEN 1 WHEN n % 10 < 8 THEN 2 WHEN n % 10 < 9 THEN 3 ELSE 4 END AS stage) st
WHERE n % 10 <> 3;

-- 30 views per Story from people spread across the population; ~half complete, 1 in 10 like.
INSERT INTO story_views (story_id, viewer_id, viewed_at, was_following)
SELECT DISTINCT ON (l.id, v.id) l.id, v.id, l.created_at + ((k * 7) || ' minutes')::interval,
       EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = v.id AND f.followee_id = l.owner_id)
FROM live l CROSS JOIN generate_series(1, 30) k
JOIN numbered v ON v.n = 1 + (l.n * 37 + k * 7919) % 100000
WHERE v.id <> l.owner_id
ON CONFLICT DO NOTHING;
INSERT INTO recommendation_events (viewer_id, event_type, creator_id, story_id, created_at)
SELECT v.viewer_id, 'story_complete', s.owner_id, v.story_id, v.viewed_at + interval '10 seconds'
FROM story_views v JOIN stories s ON s.id = v.story_id WHERE abs(hashtext(v.viewer_id::text || v.story_id::text)) % 2 = 0;
INSERT INTO recommendation_events (viewer_id, event_type, creator_id, story_id, created_at)
SELECT v.viewer_id, 'quick_creator_skip', s.owner_id, NULL, v.viewed_at + interval '2 seconds'
FROM story_views v JOIN stories s ON s.id = v.story_id WHERE abs(hashtext(v.story_id::text || v.viewer_id::text)) % 10 = 0;
INSERT INTO story_likes (story_id, user_id, created_at)
SELECT v.story_id, v.viewer_id, v.viewed_at + interval '5 seconds'
FROM story_views v WHERE abs(hashtext(v.viewer_id::text || 'like' || v.story_id::text)) % 10 = 0
ON CONFLICT DO NOTHING;
SET session_replication_role = origin;
ANALYZE;
SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM follows) AS follows, (SELECT count(*) FROM stories) AS stories,
       (SELECT count(*) FROM user_areas) AS areas, (SELECT count(*) FROM user_areas WHERE cell IS NOT NULL) AS cells,
       (SELECT count(*) FROM story_reach) AS reach_rows, (SELECT count(*) FROM story_views) AS views,
       (SELECT count(*) FROM recommendation_events) AS events, (SELECT count(*) FROM story_likes) AS likes;
