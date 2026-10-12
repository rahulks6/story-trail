-- Phase 9: public Stories earn reach beyond followers, nearest people first (spec section 9:
-- "new creators get controlled exploration"; section 43: "emerging creators can earn
-- distribution"). Additive: new tables and indexes only.
--
-- user_areas: a person's approximate area, kept only while they have "Nearby Stories" on.
-- The app sends a 4-character geohash cell (about 39 x 20 km); exact coordinates never leave
-- the phone. The time zone comes from the phone's settings and needs no permission. Neither is
-- shown to anyone or used for ads. Both are deleted with the account, and an area that hasn't
-- been refreshed for 30 days stops counting and is deleted by retention.
CREATE TABLE user_areas (
    user_id     uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    cell        text CHECK (cell ~ '^[0-9b-hjkmnp-z]{4}$'),
    time_zone   text CHECK (length(time_zone) BETWEEN 1 AND 64),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_areas_cell_idx ON user_areas (cell) WHERE cell IS NOT NULL;
CREATE INDEX user_areas_wider_idx ON user_areas ((left(cell, 3))) WHERE cell IS NOT NULL;
CREATE INDEX user_areas_time_zone_idx ON user_areas (time_zone) WHERE time_zone IS NOT NULL;

-- story_reach: how far a public Story has earned distribution among people who don't follow
-- its owner. Stages: 1 nearby (the owner's cell and the cells around it), 2 wider area (the
-- 3-character cells around it), 3 the same time zone, 4 everyone. No row yet means stage 1,
-- testing since the Story was published. The reach evaluator (worker) moves a Story up when
-- the people who saw it engage well, holds it when they don't, and widens it when there are
-- too few people nearby to tell. Followers always see a Story, whatever its stage.
CREATE TABLE story_reach (
    story_id           uuid PRIMARY KEY REFERENCES stories (id) ON DELETE CASCADE,
    stage              smallint NOT NULL DEFAULT 1 CHECK (stage BETWEEN 1 AND 4),
    held               boolean NOT NULL DEFAULT false,
    stage_started_at   timestamptz NOT NULL,
    stage_impressions  integer NOT NULL DEFAULT 0 CHECK (stage_impressions >= 0),
    stage_score        real,
    reason             text CHECK (reason IN ('engaged', 'low_engagement', 'small_audience')),
    evaluated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX story_reach_evaluated_idx ON story_reach (evaluated_at) WHERE NOT held AND stage < 4;

-- Completions of one Story, which the owner's Story Insights count (stories.repository.ts). The
-- reach evaluator looks completions up per viewer through recommendation_events_viewer_story_type_idx.
CREATE INDEX recommendation_events_story_type_idx ON recommendation_events (story_id, event_type) WHERE story_id IS NOT NULL;
