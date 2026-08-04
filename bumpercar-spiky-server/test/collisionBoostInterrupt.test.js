const assert = require("node:assert/strict")
const test = require("node:test")

const World = require("../world/world")
const RaiseSpeakiWorld = require("../world/raiseSpeakiWorld")

function setDoubleUnitsCharging(player) {
    player.boostState = "charging"
    player.input.boost = true
    player.doubleUnits.forEach((unit) => {
        unit.boostState = "charging"
        unit.boostDirectionX = 1
        unit.boostDirectionY = 0
        unit.currentSpeed = 999
    })
}

function setUpDoubleChargeCollision(world, worldName) {
    for (const entity of Array.from(world.players.values())) {
        world.grid.remove(entity)
        world.players.delete(entity.id)
    }
    const charger = world.addPlayer(`double-${worldName}`, "double", { skinName: "double" })
    const target = world.addPlayer(`target-${worldName}`, "target", { skinName: "default" })

    charger.x = 500
    charger.y = 500
    target.x = 530
    target.y = 500
    charger.doubleMerged = true
    world.ensureDoubleUnitLayout(charger)
    charger.lastMoveX = 20
    target.lastMoveX = 0
    setDoubleUnitsCharging(charger)

    return charger
}

test("collision interruption stops every live double Speaki unit in both game worlds", () => {
    for (const WorldClass of [World, RaiseSpeakiWorld]) {
        const world = new WorldClass()
        const player = setUpDoubleChargeCollision(world, WorldClass.name)

        world.resolvePlayerCollisions()

        assert.equal(player.boostState, "idle")
        assert.equal(player.input.boost, false)
        for (const unit of player.doubleUnits) {
            assert.equal(unit.boostState, "idle")
            assert.equal(unit.boostDirectionX, 0)
            assert.equal(unit.boostDirectionY, 0)
            assert.equal(unit.currentSpeed, player.collisionSlowSpeed)
            assert.ok(unit.collisionRecoveryUntil > Date.now())
            assert.equal(unit.collisionRecoveryUntil, player.collisionRecoveryUntil)
            assert.equal(unit.boostDisabledUntil, player.boostDisabledUntil)
        }
    }
})

test("boss collision handling continues to leave boss charge state untouched", () => {
    const world = new World()
    const boss = Array.from(world.players.values()).find((player) => player.isNpc)
    const now = Date.now()
    boss.boostState = "charging"

    world.applyCollisionSlow(boss, now, now + 300)

    assert.equal(boss.boostState, "charging")
})
