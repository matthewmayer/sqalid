const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const os = require('os')
const db = require('../index.js')

describe('Database and CRUD Operations', () => {
    let tempDir
    let dbPath
    let schemaPath
    let aliceId
    let bobId

    before(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'squalid-crud-'))
        dbPath = path.join(tempDir, 'test.sqlite')
        schemaPath = path.join(tempDir, 'schema.sql')

        fs.writeFileSync(schemaPath, `
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                age INTEGER
            );
            CREATE TABLE IF NOT EXISTS user_roles (
                user_id INTEGER,
                role_id INTEGER,
                PRIMARY KEY (user_id, role_id)
            );
        `)
    })

    after(async () => {
        if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true })
        }
    })

    describe('Errors when database is not open', () => {
        it('throws when createFromSchema is called without open database', async () => {
            await assert.rejects(
                async () => await db.createFromSchema(schemaPath),
                { message: 'No database' }
            )
        })

        it('throws when CRUD functions are called without open database', async () => {
            await assert.rejects(async () => await db.insert('users (name) VALUES (?)', ['test']), /No database/)
            await assert.rejects(async () => await db.update('users SET name = ?', ['test']), /No database/)
            await assert.rejects(async () => await db.selectAll('* FROM users'), /No database/)
            await assert.rejects(async () => await db.selectOne('* FROM users'), /No database/)
            await assert.rejects(async () => await db.selectValue('name FROM users'), /No database/)
            await assert.rejects(async () => await db.deleteWhere('users WHERE id = 1'), /No database/)
            await assert.rejects(async () => await db.truncate('users'), /No database/)
            await assert.rejects(async () => await db.rawSelect('SELECT 1'), /No database/)
            await assert.rejects(async () => await db.getPreparedStatement('SELECT 1'), /No database/)
        })
    })

    describe('Database lifecycle and schema creation', () => {
        it('opens database connection', async () => {
            await db.openDatabase(dbPath)
            assert.ok(fs.existsSync(dbPath))
        })

        it('throws if schema file does not exist', async () => {
            await assert.rejects(
                async () => await db.createFromSchema(path.join(tempDir, 'nonexistent.sql')),
                /does not exist/
            )
        })

        it('creates tables from schema file', async () => {
            await db.createFromSchema(schemaPath)
            const tables = await db.rawSelect("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users', 'user_roles')")
            assert.equal(tables.length, 2)
        })
    })

    describe('CRUD operations', () => {
        it('insert returns lastID', async () => {
            aliceId = await db.insert('users (name, age) VALUES (?, ?)', ['Alice', 30])
            bobId = await db.insert('users (name, age) VALUES (?, ?)', ['Bob', 25])
            assert.equal(typeof aliceId, 'number')
            assert.equal(typeof bobId, 'number')
            assert.ok(bobId > aliceId)
        })

        it('selectAll returns array of rows', async () => {
            const allUsers = await db.selectAll('* FROM users ORDER BY id ASC')
            assert.equal(allUsers.length, 2)
            assert.equal(allUsers[0].name, 'Alice')
            assert.equal(allUsers[1].name, 'Bob')

            const filteredUsers = await db.selectAll('* FROM users WHERE age > ?', [26])
            assert.equal(filteredUsers.length, 1)
            assert.equal(filteredUsers[0].name, 'Alice')
        })

        it('selectOne returns single object or undefined', async () => {
            const user = await db.selectOne('* FROM users WHERE id = ?', [aliceId])
            assert.ok(user)
            assert.equal(user.name, 'Alice')
            assert.equal(user.age, 30)

            const notFound = await db.selectOne('* FROM users WHERE id = ?', [99999])
            assert.equal(notFound, undefined)
        })

        it('selectValue returns first column value or undefined', async () => {
            const name = await db.selectValue('name FROM users WHERE id = ?', [aliceId])
            assert.equal(name, 'Alice')

            const count = await db.selectValue('COUNT(*) FROM users')
            assert.equal(count, 2)

            const notFound = await db.selectValue('name FROM users WHERE id = ?', [99999])
            assert.equal(notFound, undefined)
        })

        it('update modifies records and returns changes count', async () => {
            const changes = await db.update('users SET age = ? WHERE id = ?', [31, aliceId])
            assert.equal(changes, 1)

            const updatedAge = await db.selectValue('age FROM users WHERE id = ?', [aliceId])
            assert.equal(updatedAge, 31)
        })

        it('deleteWhere removes matching records', async () => {
            await db.deleteWhere('users WHERE id = ?', [aliceId])
            const user = await db.selectOne('* FROM users WHERE id = ?', [aliceId])
            assert.equal(user, undefined)

            const remainingCount = await db.selectValue('COUNT(*) FROM users')
            assert.equal(remainingCount, 1)
        })

        it('truncate deletes all records from table', async () => {
            await db.truncate('users')
            const count = await db.selectValue('COUNT(*) FROM users')
            assert.equal(count, 0)
        })
    })

    describe('Prepared Statements and Raw Queries', () => {
        it('rawSelect executes arbitrary SQL query', async () => {
            const result = await db.rawSelect('SELECT 42 AS answer')
            assert.deepEqual(result, [{ answer: 42 }])
        })

        it('executes prepared statements successfully', async () => {
            const stmt = await db.getPreparedStatement('INSERT INTO users (name, age) VALUES (?, ?)')
            try {
                const result = await db.runPreparedStatement(stmt, ['Charlie', 40], 'insert charlie')
                assert.ok(result.lastID)

                const user = await db.selectOne('* FROM users WHERE name = ?', ['Charlie'])
                assert.equal(user.name, 'Charlie')
                assert.equal(user.age, 40)
            } finally {
                await stmt.finalize()
            }
        })

        it('wraps prepared statement error with info', async () => {
            const stmt = await db.getPreparedStatement('INSERT INTO users (id, name, age) VALUES (?, ?, ?)')
            try {
                // insert a user with id 999
                await db.runPreparedStatement(stmt, [999, 'TestUser', 50], 'insert')
                // inserting duplicate id 999 will violate primary key constraint
                await assert.rejects(
                    async () => await db.runPreparedStatement(stmt, [999, 'DuplicateUser', 51], 'custom_info_tag'),
                    /Unexpected error when running prepared statement custom_info_tag/
                )
            } finally {
                await stmt.finalize()
            }
        })
    })

    describe('Many-to-Many helper (m2m)', () => {
        it('links two entities', async () => {
            await db.m2m('user', 'role', 1, 10, true)
            const rows = await db.selectAll('* FROM user_roles WHERE user_id = ? AND role_id = ?', [1, 10])
            assert.equal(rows.length, 1)
        })

        it('handles duplicate link gracefully (unique constraint)', async () => {
            // Should not throw on duplicate
            await db.m2m('user', 'role', 1, 10, true)
            const rows = await db.selectAll('* FROM user_roles WHERE user_id = ? AND role_id = ?', [1, 10])
            assert.equal(rows.length, 1)
        })

        it('unlinks two entities', async () => {
            await db.m2m('user', 'role', 1, 10, false)
            const rows = await db.selectAll('* FROM user_roles WHERE user_id = ? AND role_id = ?', [1, 10])
            assert.equal(rows.length, 0)
        })
    })

    describe('Database closing', () => {
        it('closes database cleanly', async () => {
            await db.closeDatabase()
            // After closing, operations should fail
            await assert.rejects(async () => await db.selectAll('* FROM users'))
        })
    })
})
