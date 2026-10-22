"""Read-only Jupiter Earn round-trip/accounting composition tests."""
import base64, json, os
from pathlib import Path
from urllib.request import Request, urlopen
from solders.hash import Hash
from solders.instruction import AccountMeta, Instruction
from solders.message import Message
from solders.pubkey import Pubkey
from solders.transaction import Transaction

RPC=os.environ["SOLANA_RPC"]
PROGRAM=Pubkey.from_string("jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9")
IDL=Path("/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/jupiter-lend-current/public/idl/lending.json")
ABC="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
def rpc(method,params):
 req=Request(RPC,data=json.dumps({"jsonrpc":"2.0","id":1,"method":method,"params":params}).encode(),headers={"content-type":"application/json"})
 with urlopen(req,timeout=120) as r:return json.load(r)
def batch(payloads):
 req=Request(RPC,data=json.dumps(payloads).encode(),headers={"content-type":"application/json"})
 with urlopen(req,timeout=120) as r:return json.load(r)
def b58(v):
 n=0
 for c in v:n=n*58+ABC.index(c)
 return b"\0"*(len(v)-len(v.lstrip("1")))+n.to_bytes((n.bit_length()+7)//8,"big")
def token_amount(account):
 if not account:return None
 raw=base64.b64decode(account["data"][0]); return int.from_bytes(raw[64:72],"little")

idl=json.loads(IDL.read_text()); specs={i["name"]:i for i in idl["instructions"]}
deposit_disc=bytes(specs["deposit"]["discriminator"])
sigs=rpc("getSignaturesForAddress",[str(PROGRAM),{"limit":100}])["result"]
payloads=[{"jsonrpc":"2.0","id":n,"method":"getTransaction","params":[s["signature"],{"encoding":"jsonParsed","commitment":"finalized","maxSupportedTransactionVersion":1}]} for n,s in enumerate(sigs)]
txs={item["id"]:item.get("result") for item in batch(payloads)}
source=None
for n,sig in enumerate(sigs):
 tx=txs.get(n)
 if not tx or tx["meta"]["err"]:continue
 for ix in tx["transaction"]["message"]["instructions"]:
  if ix.get("programId")!=str(PROGRAM) or len(ix.get("accounts",[]))!=17 or b58(ix.get("data",""))[:8]!=deposit_disc:continue
  watched=ix["accounts"][1:3]
  infos=rpc("getMultipleAccounts",[watched,{"encoding":"base64","commitment":"finalized"}])["result"]["value"]
  balances=[token_amount(a) for a in infos]
  if None not in balances and balances[0]>=2000 and balances[1]>=2000:
   source=(sig["signature"],tx,ix,infos,balances); break
 if source:break
if not source:raise RuntimeError("no recent live deposit account set with usable balances")
sig,tx,deposit0,pre_infos,pre_values=source
accounts=deposit0["accounts"]
payer=Pubkey.from_string(tx["transaction"]["message"]["accountKeys"][0]["pubkey"])
def ix(name,addresses,amount=None):
 data=bytes(specs[name]["discriminator"])+(amount.to_bytes(8,"little") if amount is not None else b"")
 metas=[AccountMeta(Pubkey.from_string(a),bool(s.get("signer")),bool(s.get("writable"))) for a,s in zip(addresses,specs[name]["accounts"])]
 return Instruction(PROGRAM,data,metas)
withdraw_accounts=[accounts[0],accounts[2],accounts[1],accounts[4],accounts[5],accounts[3],accounts[6],accounts[7],accounts[8],accounts[9],accounts[10],str(PROGRAM),accounts[11],accounts[12],accounts[13],accounts[14],accounts[15],accounts[16]]
rate_accounts=[accounts[5],accounts[3],accounts[6],accounts[7],accounts[13]]
def dep(n):return ix("deposit",accounts,n)
def wd(n):return ix("withdraw",withdraw_accounts,n)
def redeem(n):return ix("redeem",withdraw_accounts,n)
rate=ix("update_rate",rate_accounts)
cases={
 "control_deposit_1000":[dep(1000)],
 "control_withdraw_1000":[wd(1000)],
 "deposit_then_withdraw_1":[dep(1),wd(1)],
 "deposit_then_withdraw_1000":[dep(1000),wd(1000)],
 "deposit_update_rate_withdraw_1000":[dep(1000),rate,wd(1000)],
 "withdraw_then_deposit_1000":[wd(1000),dep(1000)],
 "two_deposits_then_withdraw_2000":[dep(1000),dep(1000),wd(2000)],
 "two_round_trips_1000":[dep(1000),wd(1000),dep(1000),wd(1000)],
 "deposit_then_redeem_1000_shares":[dep(1000),redeem(1000)],
}
pre={"underlying":pre_values[0],"fToken":pre_values[1]}; watched=accounts[1:3]
results=[]
for name,ixs in cases.items():
 wire=base64.b64encode(bytes(Transaction.new_unsigned(Message.new_with_blockhash(ixs,payer,Hash.default())))).decode()
 response=rpc("simulateTransaction",[wire,{"encoding":"base64","sigVerify":False,"replaceRecentBlockhash":True,"innerInstructions":True,"accounts":{"encoding":"base64","addresses":watched}}])
 value=response.get("result",{}).get("value"); returned=value.get("accounts") if value else None
 post={"underlying":token_amount(returned[0]),"fToken":token_amount(returned[1])} if returned else None
 delta={k:post[k]-pre[k] for k in pre} if post and None not in post.values() else None
 results.append({"case":name,"instructionCount":len(ixs),"err":value.get("err") if value else None,"unitsConsumed":value.get("unitsConsumed") if value else None,"postBalances":post,"balanceDeltas":delta,"logs":value.get("logs") if value else None,"rpcError":response.get("error")})
print(json.dumps({"program":str(PROGRAM),"sourceSignature":sig,"sourceSlot":tx["slot"],"poolMint":accounts[3],"watchedAccounts":{"underlying":accounts[1],"fToken":accounts[2]},"preBalances":pre,"transport":"mainnet simulateTransaction only; no sendTransaction","results":results},indent=2))
