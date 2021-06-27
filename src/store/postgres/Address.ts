import {IStorageAddress} from 'src/store/interface'
import {
  Address2Transaction,
  Block,
  Filter,
  AddressTransactionType,
  Address,
  InternalTransaction,
} from 'src/types'
import {Query} from 'src/store/postgres/types'
import {fromSnakeToCamelResponse, generateQuery} from 'src/store/postgres/queryMapper'
import {buildSQLQuery} from 'src/store/postgres/filters'

export class PostgresStorageAddress implements IStorageAddress {
  query: Query

  constructor(query: Query) {
    this.query = query
  }

  addAddress2Transaction = async (entry: Address2Transaction) => {
    if (!entry.transactionHash) {
      return
    }

    // const {query, params} = generateQuery(newEntry)
    // store latest 100 relations
    return await this.query(
      `insert into address2transaction_fifo (transaction_hashes,address,transaction_type) values(array[$1],$2,$3)
      on conflict (address, transaction_type) do update
      set transaction_hashes = (array_cat(EXCLUDED.transaction_hashes, address2transaction_fifo.transaction_hashes))[:100];`,
      [entry.transactionHash, entry.address, entry.transactionType]
    )
  }

  getRelatedTransactionsByType = async (
    address: Address,
    type: AddressTransactionType,
    filter: Filter
  ): Promise<Address2Transaction[]> => {
    const {offset = 0, limit = 10} = filter
    // Only latest 100 entries currently supported
    if (offset + limit > 100) {
      return []
    }

    const res = await this.query(
      `select transaction_hashes from address2transaction_fifo where address=$1 and transaction_type=$2`,
      [address, type]
    )

    if (!res || !res[0]) {
      return []
    }

    const allHashes = res[0].transaction_hashes

    if (!allHashes || !allHashes.length) {
      return []
    }

    const hashes = allHashes.slice(offset, offset + limit)

    if (type === 'staking_transaction') {
      const txs = await this.query(`select * from staking_transactions where hash = any ($1)`, [
        hashes,
      ])

      return txs
        .map(fromSnakeToCamelResponse)
        .sort((a: InternalTransaction, b: InternalTransaction) => b.blockNumber - a.blockNumber)
    }

    const txs = await this.query(`select * from transactions where hash = any ($1)`, [hashes])

    if (type === 'transaction' || type === 'internal_transaction') {
      return txs
        .map(fromSnakeToCamelResponse)
        .sort((a: InternalTransaction, b: InternalTransaction) => b.blockNumber - a.blockNumber)
    }

    // for erc20 and erc721 we add logs to payload
    const txsWithLogs = (await Promise.all(
      txs.map(fromSnakeToCamelResponse).map(async (tx: any) => {
        tx.logs = await this.query('select * from logs where transaction_hash=$1', [tx.hash])
        return tx
      })
    )) as Address2Transaction[]

    return txsWithLogs.sort((a, b) => b.blockNumber - a.blockNumber)
  }
}
