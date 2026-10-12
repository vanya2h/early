import type { GlobalState } from '../models.js'
import type { AppMarket } from './app-market.js'
import type { UserActor } from './actors/user-actor.js'
import type { CreatorActor } from './actors/creator-actor.js'
import type { InvestorActor } from './actors/investor-actor.js'
import type { TraderActor } from './actors/trader-actor.js'

/**
 * Wraps GlobalState; single source of truth for the simulation.
 * Actors reference this to access apps and other actors.
 */
export class World {
  apps: AppMarket[]
  users: UserActor[]
  creators: CreatorActor[]
  investors: InvestorActor[]
  traders: TraderActor[]
  tick: number
  protocolTreasury: number

  constructor() {
    this.apps = []
    this.users = []
    this.creators = []
    this.investors = []
    this.traders = []
    this.tick = 0
    this.protocolTreasury = 0
  }

  /** Look up an AppMarket by id. */
  getApp(id: string): AppMarket | undefined {
    return this.apps.find(a => a.data.id === id)
  }

  /** All actor instances (users + creators + investors + traders). */
  allActors(): Array<UserActor | CreatorActor | InvestorActor | TraderActor> {
    return [...this.users, ...this.creators, ...this.investors, ...this.traders]
  }

  /** Snapshot as plain GlobalState data. */
  snapshot(): GlobalState {
    const allActors = this.allActors().map(a => {
      if ('snapshot' in a && typeof a.snapshot === 'function') {
        return (a as { snapshot(): ReturnType<typeof a.snapshot> }).snapshot()
      }
      return a as never
    })

    let totalLockedValue = 0
    let totalDau = 0
    for (const app of this.apps) {
      totalLockedValue += app.totalLockedValue
      totalDau += app.data.dailyRequests
    }

    return {
      tick: this.tick,
      apps: this.apps.map(a => a.data),
      actors: allActors,
      protocolTreasury: this.protocolTreasury,
      totalLockedValue,
      totalDau,
    }
  }
}
