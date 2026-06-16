# Keep memory and retrieval file-backed

WalnutPi keeps Durable Memory, Daily Notes, Session Logs, and Retrieval Corpus as file-backed, auditable local artifacts for the current product stage. This fits the headless WalnutPi Device, keeps privacy and secret filtering inspectable, and is sufficient while the project corpus is small.

**Consequences**

Vector databases, embedding indexes, and heavier retrieval services should not become the default memory path yet. They may be introduced later only as an explicit upgrade with a clear privacy, storage, performance, and migration story.
