CREATE TABLE IF NOT EXISTS knowledge_topic_aliases (
  alias TEXT NOT NULL,
  topic_key TEXT NOT NULL,
  PRIMARY KEY (alias, topic_key),
  FOREIGN KEY (topic_key) REFERENCES knowledge_facts(topic_key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_knowledge_topic_aliases_topic ON knowledge_topic_aliases(topic_key);
