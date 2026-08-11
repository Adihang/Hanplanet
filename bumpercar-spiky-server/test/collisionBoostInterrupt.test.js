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

function assertDoubleDashInterrupted(player, options = {}) {
    assert.equal(player.boostState, "idle")
    assert.equal(player.input.boost, false)
    assert.equal(player.boostReleaseRequired, true)
    assert.equal(player.boostDirectionX, 0)
    assert.equal(player.boostDirectionY, 0)
    if (options.expectBounce) {
        assert.ok(player.lastMoveX < 0)
    }
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

test("collision interruption stops every live double Speaki unit in both game worlds", () => {
    for (const WorldClass of [World, RaiseSpeakiWorld]) {
        const world = new WorldClass()
        const player = setUpDoubleChargeCollision(world, WorldClass.name)

        world.resolvePlayerCollisions()

        assertDoubleDashInterrupted(player, { expectBounce: true })
        world.handleInput(player, { right: true, boost: true })
        assert.equal(player.input.boost, false)
        world.update()
        assert.equal(player.boostState, "idle")
        player.doubleUnits.forEach((unit) => assert.equal(unit.boostState, "idle"))
    }
})

test("double Speaki dash is interrupted when it hits a pumpkin NPC in both game worlds", () => {
    for (const WorldClass of [World, RaiseSpeakiWorld]) {
        const world = new WorldClass()
        const player = setUpDoubleChargeCollision(world, `${WorldClass.name}-pumpkin`)
        const regularTarget = Array.from(world.players.values()).find((candidate) => candidate !== player)
        regularTarget.x = 1000
        regularTarget.y = 500
        const pumpkinNpc = world.spawnPumpkinNpc({ x: 530, y: 500 })
        pumpkinNpc.lastMoveX = 0

        world.resolvePlayerCollisions()

        assertDoubleDashInterrupted(player)
        assert.equal(pumpkinNpc.boostState, "charging")
        assert.equal(player.lastMoveX, 0)
        assert.equal(player.lastMoveY, 0)
        player.doubleUnits.forEach((unit) => {
            assert.equal(unit.lastMoveX, 0)
            assert.equal(unit.lastMoveY, 0)
        })
        world.handleInput(player, { right: true, boost: true })
        assert.equal(player.input.boost, false)
    }
})

test("a double Speaki wall collision interrupts both units and requires boost release", () => {
    for (const WorldClass of [World, RaiseSpeakiWorld]) {
        const world = new WorldClass()
        const player = world.addPlayer(`double-wall-${WorldClass.name}`, "double", { skinName: "double" })
        player.doubleMerged = false
        player.x = 1999
        player.y = 500
        world.ensureDoubleUnitLayout(player)
        player.doubleUnits[0].x = 1999.9
        player.doubleUnits[0].y = 500
        player.doubleUnits[0].boostState = "charging"
        player.doubleUnits[0].boostDirectionX = 1
        player.doubleUnits[0].boostDirectionY = 0
        player.doubleUnits[0].currentSpeed = 999
        player.doubleUnits[1].x = 1900
        player.doubleUnits[1].y = 500
        player.doubleUnits[1].boostState = "charging"
        player.doubleUnits[1].boostDirectionX = 1
        player.doubleUnits[1].boostDirectionY = 0
        player.doubleUnits[1].currentSpeed = 999
        player.input.boost = true

        world.updateDoubleUnits(player, Date.now(), 1, 0)

        assert.equal(player.boostState, "idle")
        assert.equal(player.input.boost, false)
        assert.equal(player.boostReleaseRequired, true)
        player.doubleUnits.forEach((unit) => {
            assert.equal(unit.boostState, "idle")
            assert.equal(unit.boostDirectionX, 0)
            assert.equal(unit.boostDirectionY, 0)
        })
    }
})

test("charging user is interrupted and bounced backward in both game worlds", () => {
    for (const WorldClass of [World, RaiseSpeakiWorld]) {
        const world = new WorldClass()
        for (const entity of Array.from(world.players.values())) {
            world.grid.remove(entity)
            world.players.delete(entity.id)
        }
        const player = world.addPlayer(`user-${WorldClass.name}`, "user", { skinName: "default" })
        const target = world.addPlayer(`user-target-${WorldClass.name}`, "target", { skinName: "default" })
        player.x = 500
        player.y = 500
        target.x = 530
        target.y = 500
        player.input.boost = true
        player.boostState = "charging"
        player.boostDirectionX = 1
        player.boostDirectionY = 0
        player.currentSpeed = 480
        player.lastMoveX = 20

        world.resolvePlayerCollisions()

        assert.equal(player.boostState, "idle")
        assert.equal(player.input.boost, false)
        assert.ok(player.collisionRecoveryUntil > Date.now())
        assert.ok(player.lastMoveX < 0)
    }
})

test("charging boss is interrupted and bounced backward on player collision", () => {
    const world = new World()
    for (const entity of Array.from(world.players.values())) {
        world.grid.remove(entity)
        world.players.delete(entity.id)
    }
    const boss = world.spawnNerNpcPlayer("boss-charge", { x: 500, y: 500 })
    const target = world.addPlayer("boss-target", "target", { skinName: "default" })
    target.x = 530
    target.y = 500
    boss.boostState = "charging"
    boss.npcState = "charging"
    boss.npcTargetId = target.id
    boss.npcChargeDirectionX = 1
    boss.npcChargeDirectionY = 0
    boss.npcChargeDistanceRemaining = 180
    boss.npcChargeDistanceTotal = 180
    boss.npcQueuedExtraCharges = 1
    boss.currentSpeed = 480
    boss.lastMoveX = 20

    world.resolvePlayerCollisions()

    assert.equal(boss.boostState, "idle")
    assert.equal(boss.npcState, "rest")
    assert.equal(boss.npcTargetId, "")
    assert.equal(boss.npcChargeDistanceRemaining, 0)
    assert.equal(boss.npcChargeDistanceTotal, 0)
    assert.equal(boss.npcQueuedExtraCharges, 0)
    assert.ok(boss.collisionRecoveryUntil > Date.now())
    assert.ok(boss.lastMoveX < 0)
})

test("charging dummy is interrupted and bounced backward in both game worlds", () => {
    for (const WorldClass of [World, RaiseSpeakiWorld]) {
        const world = new WorldClass()
        for (const entity of Array.from(world.players.values())) {
            world.grid.remove(entity)
            world.players.delete(entity.id)
        }
        const dummy = world.addPlayer(`dummy-${WorldClass.name}`, "dummy", { skinName: "default" })
        const target = world.addPlayer(`dummy-target-${WorldClass.name}`, "target", { skinName: "default" })
        dummy.isDummy = true
        dummy.x = 500
        dummy.y = 500
        target.x = 530
        target.y = 500
        dummy.boostState = "charging"
        dummy.dummyState = "charging"
        dummy.boostDirectionX = 1
        dummy.boostDirectionY = 0
        dummy.dummyChargeDistanceRemaining = 180
        dummy.dummyChargeDistanceTotal = 180
        dummy.dummyQueuedExtraCharges = 1
        dummy.currentSpeed = 480
        dummy.lastMoveX = 20

        world.resolvePlayerCollisions()

        assert.equal(dummy.boostState, "idle")
        assert.equal(dummy.dummyState, "rest")
        assert.equal(dummy.dummyChargeDistanceRemaining, 0)
        assert.equal(dummy.dummyChargeDistanceTotal, 0)
        assert.equal(dummy.dummyQueuedExtraCharges, 0)
        assert.ok(dummy.collisionRecoveryUntil > Date.now())
        assert.ok(dummy.lastMoveX < 0)
    }
})
