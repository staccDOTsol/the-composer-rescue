"""Compact finalized census of current Jupiter Liquidity claims/reserves."""
import base64,json,os
from urllib.request import Request,urlopen
RPC=os.environ["SOLANA_RPC"];PROGRAM="jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC"
def rpc(method,params):
 req=Request(RPC,data=json.dumps({"jsonrpc":"2.0","id":1,"method":method,"params":params}).encode(),headers={"content-type":"application/json"})
 with urlopen(req,timeout=120) as r:return json.load(r)
def accounts(size):return rpc("getProgramAccounts",[PROGRAM,{"encoding":"base64","commitment":"finalized","filters":[{"dataSize":size}]}])["result"]
claims=accounts(80);reserves=accounts(192)
claim_rows=[]
for row in claims:
 data=base64.b64decode(row["account"]["data"][0]);amount=int.from_bytes(data[40:48],"little")
 if amount:claim_rows.append({"address":row["pubkey"],"amount":amount})
reserve_rows=[]
for row in reserves:
 data=base64.b64decode(row["account"]["data"][0]);amount=int.from_bytes(data[136:144],"little")
 if amount:reserve_rows.append({"address":row["pubkey"],"totalClaimAmount":amount})
print(json.dumps({"program":PROGRAM,"commitment":"finalized","observedSlot":rpc("getSlot",[{"commitment":"finalized"}])["result"],"userClaimAccounts":len(claims),"nonzeroUserClaims":claim_rows,"tokenReserveAccounts":len(reserves),"nonzeroReserveTotalClaims":reserve_rows,"transport":"read-only getProgramAccounts/getSlot"},indent=2))
