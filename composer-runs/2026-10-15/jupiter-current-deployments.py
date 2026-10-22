"""Hash deployed Jupiter Lend binaries directly from finalized RPC account data."""
import base64, hashlib, json, os
from urllib.request import Request, urlopen
from solders.pubkey import Pubkey

RPC=os.environ["SOLANA_RPC"]
PROGRAMS={
 "liquidity":"jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC",
 "vaults":"jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi",
 "flashloan":"jupgfSgfuAXv4B6R2Uxu85Z1qdzgju79s6MfZekN6XS",
 "oracle":"jupnw4B6Eqs7ft6rxpzYLJZYSnrpRgPcr589n5Kv4oc",
 "lending":"jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9",
 "dex":"jupZ4m2GqUCJ5iueMfzQf8khFfH31d4XAQt3RzCT9Vd",
}
def rpc(method,params):
 req=Request(RPC,data=json.dumps({"jsonrpc":"2.0","id":1,"method":method,"params":params}).encode(),headers={"content-type":"application/json"})
 with urlopen(req,timeout=120) as r:return json.load(r)
def account(address):
 result=rpc("getAccountInfo",[address,{"encoding":"base64","commitment":"finalized"}])["result"]
 return result["context"]["slot"],base64.b64decode(result["value"]["data"][0]),result["value"]["owner"]
rows=[]
for name,address in PROGRAMS.items():
 program_slot,program_data,loader=account(address)
 if int.from_bytes(program_data[:4],"little")!=2:raise RuntimeError(f"{address} is not upgradeable Program state")
 programdata=str(Pubkey.from_bytes(program_data[4:36]))
 context_slot,data,programdata_owner=account(programdata)
 if int.from_bytes(data[:4],"little")!=3:raise RuntimeError(f"{programdata} is not ProgramData state")
 deploy_slot=int.from_bytes(data[4:12],"little")
 tag=data[12]
 authority=str(Pubkey.from_bytes(data[13:45])) if tag==1 else None
 header=45 if tag==1 else 13
 elf=data[header:]
 rows.append({"component":name,"program":address,"programdata":programdata,"rpcContextSlot":min(program_slot,context_slot),"deploySlot":deploy_slot,"upgradeAuthority":authority,"binaryBytes":len(elf),"binarySha256":hashlib.sha256(elf).hexdigest(),"loader":loader,"programdataOwner":programdata_owner})
print(json.dumps({"commitment":"finalized","transport":"read-only getAccountInfo","programs":rows},indent=2))
