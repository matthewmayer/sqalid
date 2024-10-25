== Squalid ==

Squalid is a simple SQLlite wrapper for Node.js.

## Installation

```bash
npm install squalid
```

## Usage

Create a schema e.g. in a file called `schema.txt

```sql
CREATE TABLE IF NOT EXISTS `things` (
    `id` INTEGER PRIMARY KEY AUTOINCREMENT,
    `name` varchar(255) NOT NULL,
    `size` INTEGER,
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

```js
const db = require("squalid");
await db.openDatabase("test.sqlite");
// run all the sql in the schema file
await db.createFromSchema("schema.sql");

// optionally run migrations e.g. ALTER TABLE statements
await db.runMigrations("migrations.sql");

// insert a new thing
const thing_id = await db.insert("things (name, size) VALUES (?, ?)", ["Thing 1", 10]);

// select all things
const things = await db.selectAll("* FROM things");
console.dir(things);

// select one thing
const thing = await db.selectOne("* FROM things WHERE id = ?", [thing_id]);
console.log(thing)

// select a single value or count
const name = await db.selectValue("name FROM things WHERE id = ?", [thing_id]);
console.log(name);
const count = await db.selectValue("COUNT(*) FROM things");
console.log(count);

// update the thing
await db.update("things SET name = ?, size = ? WHERE id = ?", ["Thing 2", 20, thing_id]);

// delete the thing
await db.deleteWhere("things WHERE id = ?", [thing_id]);

// delete all the things
await db.truncate("things");
```
