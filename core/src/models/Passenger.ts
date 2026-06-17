/** A person whose flights are tracked. May or may not own a Southwest login. */
export interface Passenger {
  id: string;
  /** Full name as it appears on the booking. */
  fullName: string;
  /** Optional Rapid Rewards number for matching scraped trips. */
  rapidRewardsNumber?: string;
  /** Account ids this passenger is associated with (a passenger may be a
   *  companion on someone else's account). */
  accountIds: string[];
  createdAt: string;
  updatedAt: string;
}

export type NewPassenger = Omit<Passenger, 'id' | 'createdAt' | 'updatedAt'>;
