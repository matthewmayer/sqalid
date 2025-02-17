"use strict"
const sqlite = require('sqlite')
const sqlite3 = require('sqlite3')
const fs = require('fs')
let db = null
async function openDatabase(filename) {
    db = await sqlite.open({
        filename: filename,
        driver: sqlite3.Database
    })
}
async function createFromSchema(filename) {
    if (!db) {
        throw new Error("No database")
    }
    if (!fs.existsSync(filename)) {
        throw new Error(`Schema file ${filename} does not exist`)
    }
    const schema = fs.readFileSync(filename, 'utf8')
    await db.exec(schema)
}
async function closeDatabase() {
    try {
        // Close the database connection
        await db.close()
        console.log('Database connection closed')
    } catch (err) {
        console.error('Error closing database:', err)
    }
}
async function insert(sql, params) {
    if (!db) {
        throw ("No database")
    }
    const results = await db.run(`INSERT INTO ${sql}`, params)
    return results.lastID
}
async function update(sql, params) {
    if (!db) {
        throw ("No database")
    }
    const results = await db.run(`UPDATE ${sql}`, params)
    return results.changes
}
async function selectAll(sql, params) {
    if (!db) {
        throw ("No database")
    }
    const rows = await db.all(`SELECT ${sql}`, params)
    return rows
}
async function rawSelect(sql, params) {
    if (!db) {
        throw ("No database")
    }
    const rows = await db.all(sql, params)
    return rows
}
async function getPreparedStatement(sql) {
    if (!db) {
        throw ("No database")
    }
    return await db.prepare(sql)
}
async function runPreparedStatement(statement, params, info) {
    if (!db) {
        throw ("No database")
    }
    try {
        const ret = await statement.run(...params)
        return ret
    } catch (e) {
        throw ("Unexpected error when running prepared statement " + info)
    }
}
async function selectOne(sql, params) {
    if (!db) {
        throw ("No database")
    }
    const row = await db.get(`SELECT ${sql}`, params)
    return row
}
async function selectValue(sql, params) {
    if (!db) {
        throw ("No database")
    }
    const row = await db.get(`SELECT ${sql}`, params)
    if (!row) {
        return undefined
    }
    const [firstColumnValue] = Object.values(row)
    return firstColumnValue
}
async function deleteWhere(sql, params) {
    if (!db) {
        throw ("No database")
    }
    await db.run(`DELETE FROM ${sql}`, params)
}
async function truncate(table) {
    if (!db) {
        throw ("No database")
    }
    await db.run(`DELETE FROM ${table}`)
}
async function m2m(table1, table2, id1, id2, linked) {
    if (linked) {
        const sql = `${table1}_${table2}s (${table1}_id, ${table2}_id) VALUES (?, ?)`
        try {
            await insert(sql, [id1, id2])
        } catch (e) {
            console.warn(e)
            //unique constraint failed
        }
    } else {
        //delete
        const sql = `DELETE FROM ${table1}_${table2}s WHERE ${table1}_id=? AND ${table2}_id=?`
        try {
            await db.run(sql, [id1, id2])
        } catch (e) {
            console.warn(e)
            //could this fail?
        }
    }
}
async function runMigrations(filename, verbose = true) {
    const migrations = fs.readFileSync(filename, 'utf8')
    const statements = migrations.split(';')
    for (const statement of statements) {
        if (statement.trim() === '') {
            continue
        }
        try {
            await db.exec(statement)
            if (verbose) {
                console.log("Migration applied: " + statement)
            }
        } catch (e) {
            if (verbose) {
                console.log("Migration already applied: " + statement)
            }
        }
    }
}


module.exports = {
    closeDatabase,
    createFromSchema,
    deleteWhere,
    getPreparedStatement,
    runPreparedStatement,
    rawSelect,
    insert,
    m2m,
    openDatabase,
    runMigrations,
    selectAll,
    selectOne,
    selectValue,
    update,
    truncate
}