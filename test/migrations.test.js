const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const os = require('os')
const db = require('../index.js')

describe('Migrations', () => {
    let tempDir
    let dbPath

    before(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'squalid-migrations-'))
        dbPath = path.join(tempDir, 'test.sqlite')
        await db.openDatabase(dbPath)
    })

    after(async () => {
        try {
            await db.closeDatabase()
        } catch {
            // ignore
        }
        if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true })
        }
    })

    describe('Single-file migrations', () => {
        it('applies migrations from a single file with multiple statements', async () => {
            const migrationFile = path.join(tempDir, '001_initial.sql')
            fs.writeFileSync(migrationFile, `
                CREATE TABLE articles (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL
                );

                INSERT INTO articles (title) VALUES ('Hello World');
                ;
            `)

            await db.runMigrations(migrationFile)

            const articles = await db.selectAll('* FROM articles')
            assert.equal(articles.length, 1)
            assert.equal(articles[0].title, 'Hello World')
        })

        it('handles re-running a migration file gracefully', async () => {
            const migrationFile = path.join(tempDir, '001_initial.sql')
            // Re-running table creation without IF NOT EXISTS normally throws,
            // but runMigrations catches already-applied statements
            await db.runMigrations(migrationFile)
            const count = await db.selectValue('COUNT(*) FROM articles')
            // The INSERT ran again (or succeeded), table creation was caught
            assert.ok(count >= 1)
        })

        it('supports running single file via options object', async () => {
            const file = path.join(tempDir, 'file_option.sql')
            fs.writeFileSync(file, 'CREATE TABLE IF NOT EXISTS options_test (id INTEGER PRIMARY KEY);')
            await db.runMigrations({ file })
            const tables = await db.rawSelect("SELECT name FROM sqlite_master WHERE type='table' AND name='options_test'")
            assert.equal(tables.length, 1)
        })
    })

    describe('Folder migrations', () => {
        let migrationsDir

        before(() => {
            migrationsDir = path.join(tempDir, 'migrations_order_test')
            fs.mkdirSync(migrationsDir)

            // Intentionally write files out of alphabetical order
            // 03 depends on column added in 02
            // 02 depends on table created in 01
            fs.writeFileSync(
                path.join(migrationsDir, '03_insert_records.sql'),
                "INSERT INTO products (id, name, price) VALUES (1, 'Widget', 19.99);"
            )
            fs.writeFileSync(
                path.join(migrationsDir, '01_create_products.sql'),
                'CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT NOT NULL);'
            )
            fs.writeFileSync(
                path.join(migrationsDir, '02_add_price.SQL'),
                'ALTER TABLE products ADD COLUMN price REAL;'
            )

            // Files and directories that must be ignored
            fs.writeFileSync(path.join(migrationsDir, 'README.md'), '# Ignore this')
            fs.writeFileSync(path.join(migrationsDir, 'notes.txt'), 'Not SQL')
            fs.writeFileSync(path.join(migrationsDir, '.hidden_migration.sql'), 'SYNTAX ERROR THAT WOULD FAIL;')
            fs.mkdirSync(path.join(migrationsDir, 'subfolder.sql'))
        })

        it('executes .sql files strictly in alphabetical order and ignores non-sql files/subdirectories', async () => {
            await db.runMigrationsFolder(migrationsDir)

            const product = await db.selectOne('* FROM products WHERE id = 1')
            assert.ok(product)
            assert.equal(product.name, 'Widget')
            assert.equal(product.price, 19.99)
        })

        it('handles re-running folder migrations without crashing', async () => {
            await db.runMigrationsFolder(migrationsDir)
            const count = await db.selectValue('COUNT(*) FROM products WHERE id = 1')
            assert.equal(count, 1)
        })

        it('supports runMigrations with a directory path directly', async () => {
            const dir = path.join(tempDir, 'dir_auto_detect')
            fs.mkdirSync(dir)
            fs.writeFileSync(path.join(dir, '01_orders.sql'), 'CREATE TABLE orders (id INTEGER PRIMARY KEY, total REAL);')
            fs.writeFileSync(path.join(dir, '02_orders.sql'), 'INSERT INTO orders (id, total) VALUES (1, 99.50);')

            await db.runMigrations(dir)

            const order = await db.selectOne('* FROM orders WHERE id = 1')
            assert.ok(order)
            assert.equal(order.total, 99.50)
        })

        it('supports options object with folder property', async () => {
            const dir = path.join(tempDir, 'options_folder_test')
            fs.mkdirSync(dir)
            fs.writeFileSync(path.join(dir, '01_items.sql'), 'CREATE TABLE items (id INTEGER PRIMARY KEY);')

            await db.runMigrations({ folder: dir })

            const tables = await db.rawSelect("SELECT name FROM sqlite_master WHERE type='table' AND name='items'")
            assert.equal(tables.length, 1)
        })

        it('supports aliases runMigrationFolder and runMigrationsFromFolder', async () => {
            const dir1 = path.join(tempDir, 'alias1')
            fs.mkdirSync(dir1)
            fs.writeFileSync(path.join(dir1, '01_t1.sql'), 'CREATE TABLE t1 (id INTEGER PRIMARY KEY);')
            await db.runMigrationFolder(dir1)

            const dir2 = path.join(tempDir, 'alias2')
            fs.mkdirSync(dir2)
            fs.writeFileSync(path.join(dir2, '01_t2.sql'), 'CREATE TABLE t2 (id INTEGER PRIMARY KEY);')
            await db.runMigrationsFromFolder(dir2)

            const tables = await db.rawSelect("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('t1', 't2')")
            assert.equal(tables.length, 2)
        })
    })

    describe('Verbose logging', () => {
        it('logs applied and already applied migrations when verbose is true', async () => {
            const logs = []
            const originalLog = console.log
            console.log = (...args) => logs.push(args.join(' '))

            try {
                const verboseDir = path.join(tempDir, 'verbose_test')
                fs.mkdirSync(verboseDir)
                fs.writeFileSync(path.join(verboseDir, '01_v.sql'), 'CREATE TABLE v_test (id INT);')

                // First run: applied
                await db.runMigrationsFolder(verboseDir, true)
                // Second run: already applied
                await db.runMigrationsFolder(verboseDir, true)
            } finally {
                console.log = originalLog
            }

            const appliedLog = logs.some(log => log.includes('Migration applied:'))
            const alreadyAppliedLog = logs.some(log => log.includes('Migration already applied:'))
            assert.ok(appliedLog, 'Expected "Migration applied:" in logs')
            assert.ok(alreadyAppliedLog, 'Expected "Migration already applied:" in logs')
        })
    })

    describe('Migration error handling', () => {
        it('throws error when migrations folder does not exist', async () => {
            await assert.rejects(
                async () => await db.runMigrationsFolder(path.join(tempDir, 'does_not_exist')),
                /Migrations folder .* does not exist/
            )
        })

        it('throws error when migrations folder path is a file', async () => {
            const notADir = path.join(tempDir, 'not_a_dir.txt')
            fs.writeFileSync(notADir, 'hello')
            await assert.rejects(
                async () => await db.runMigrationsFolder(notADir),
                /is not a directory/
            )
        })
    })
})
