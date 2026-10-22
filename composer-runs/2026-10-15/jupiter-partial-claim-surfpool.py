"""Current-binary partial-claim accounting tests on a Surfpool mainnet fork."""
import base64,json,os
from pathlib import Path
from urllib.request import Request,urlopen
from solders.hash import Hash
from solders.instruction import AccountMeta,Instruction
from solders.message import Message
from solders.pubkey import Pubkey
from solders.transaction import Transaction

LIVE=os.environ["SOLANA_RPC"]; LOCAL="http://127.0.0.1:18999"
PROGRAM=Pubkey.from_string("jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC")
SYSTEM=Pubkey.from_string("11111111111111111111111111111111")
SIG="36RevePJBmz4jkfdrWxu7npksx2WMf4n3bBYVpPyoAuyojoRwrpf1YEUyCZ252mHH9pUsTB4YEtHWdqpjDhsxkZA"
IDL=Path("/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/jupiter-lend-current/public/idl/liquidity.json")
ABC="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
def rpc(url,method,params):
 req=Request(url,data=json.dumps({"jsonrpc":"2.0","id":1,"method":method,"params":params}).encode(),headers={"content-type":"application/json"})
 with urlopen(req,timeout=120) as r:return json.load(r)
def b58(v):
 n=0
 for c in v:n=n*58+ABC.index(c)
 return b"\0"*(len(v)-len(v.lstrip("1")))+n.to_bytes((n.bit_length()+7)//8,"big")
def raw_account(address):
 result=rpc(LOCAL,"getAccountInfo",[str(address),{"encoding":"base64","commitment":"processed"}])["result"]["value"]
 return base64.b64decode(result["data"][0]) if result else None
def account_value(address):return rpc(LOCAL,"getAccountInfo",[str(address),{"encoding":"base64","commitment":"processed"}])["result"]["value"]
def token_amount(raw):return int.from_bytes(raw[64:72],"little") if raw else None
def claim_amount(raw):return int.from_bytes(raw[40:48],"little") if raw else None
def reserve_claim(raw):return int.from_bytes(raw[136:144],"little") if raw else None

idl=json.loads(IDL.read_text()); specs={i["name"]:i for i in idl["instructions"]}
tx=rpc(LIVE,"getTransaction",[SIG,{"encoding":"jsonParsed","commitment":"finalized","maxSupportedTransactionVersion":0}])["result"]
ops=[i for outer in tx["meta"]["innerInstructions"] for i in outer["instructions"] if i.get("programId")==str(PROGRAM) and len(i.get("accounts",[]))==13]
original=next(i for i in ops if int.from_bytes(b58(i["data"])[24:40],"little",signed=True)>0)
raw=bytearray(b58(original["data"])); raw[-1]=2
borrow_amount=int.from_bytes(raw[24:40],"little",signed=True)
mint=Pubkey.from_string(original["accounts"][3]); liquidity=Pubkey.from_string(original["accounts"][1]); reserve=Pubkey.from_string(original["accounts"][2]); vault=Pubkey.from_string(original["accounts"][4]); recipient_token=Pubkey.from_string(original["accounts"][9]); token_program=Pubkey.from_string(original["accounts"][12]); borrow_to=Pubkey.from_bytes(bytes(raw[72:104])); payer=Pubkey.from_string(tx["transaction"]["message"]["accountKeys"][0]["pubkey"])
claim_pda,bump=Pubkey.find_program_address([b"user_claim",bytes(borrow_to),bytes(mint)],PROGRAM)
init=Instruction(PROGRAM,bytes(specs["init_claim_account"]["discriminator"])+bytes(mint)+bytes(borrow_to),[AccountMeta(payer,True,True),AccountMeta(claim_pda,False,True),AccountMeta(SYSTEM,False,False)])
op_accounts=list(original["accounts"]);op_accounts[10]=str(claim_pda)
operate=Instruction(PROGRAM,bytes(raw),[AccountMeta(Pubkey.from_string(a),pos==0,bool(s.get("writable"))) for pos,(a,s) in enumerate(zip(op_accounts,specs["operate"]["accounts"]))])
claim=Instruction(PROGRAM,bytes(specs["claim"]["discriminator"])+bytes(borrow_to),[
 AccountMeta(borrow_to,True,False),AccountMeta(liquidity,False,False),AccountMeta(reserve,False,True),AccountMeta(mint,False,False),AccountMeta(recipient_token,False,True),AccountMeta(vault,False,True),AccountMeta(claim_pda,False,True),AccountMeta(token_program,False,False)])
close=Instruction(PROGRAM,bytes(specs["close_claim_account"]["discriminator"])+bytes(mint),[AccountMeta(borrow_to,True,True),AccountMeta(claim_pda,False,True),AccountMeta(SYSTEM,False,False)])
watched=[str(claim_pda),str(reserve),str(vault),str(recipient_token)]
def set_vault(amount):
 response=rpc(LOCAL,"surfnet_setTokenAccount",[str(liquidity),str(mint),{"amount":amount},str(token_program)])
 if response.get("error"):raise RuntimeError(response["error"])
 actual=token_amount(raw_account(vault))
 if actual!=amount:raise RuntimeError(f"fork vault amount mismatch: {actual} != {amount}")
 return response.get("result")
def simulate(name,ixs,vault_amount):
 set_vault(vault_amount); pre_recipient=token_amount(raw_account(recipient_token)); blockhash=Hash.from_string(rpc(LOCAL,"getLatestBlockhash",[{"commitment":"processed"}])["result"]["value"]["blockhash"])
 wire=base64.b64encode(bytes(Transaction.new_unsigned(Message.new_with_blockhash(ixs,payer,blockhash)))).decode()
 response=rpc(LOCAL,"simulateTransaction",[wire,{"encoding":"base64","sigVerify":False,"accounts":{"encoding":"base64","addresses":watched}}]);value=response.get("result",{}).get("value"); accounts=value.get("accounts") if value else None
 decoded=None
 if accounts:
  raws=[base64.b64decode(a["data"][0]) if a else None for a in accounts]
  decoded={"userClaimAmount":claim_amount(raws[0]),"reserveTotalClaim":reserve_claim(raws[1]),"vaultAmount":token_amount(raws[2]),"recipientAmount":token_amount(raws[3]),"recipientDelta":token_amount(raws[3])-pre_recipient if raws[3] else None,"claimClosed":accounts[0] is None}
 return {"case":name,"forkVaultStart":vault_amount,"err":value.get("err") if value else None,"unitsConsumed":value.get("unitsConsumed") if value else None,"post":decoded,"logs":value.get("logs") if value else None,"rpcError":response.get("error")}
partial=max(1,borrow_amount//2); full=borrow_amount+1_000_000
results=[
 simulate("claim_creation_control",[init,operate],full),
 simulate("full_claim",[init,operate,claim],full),
 simulate("partial_claim",[init,operate,claim],partial),
 simulate("duplicate_claim_after_partial",[init,operate,claim,claim],partial),
 simulate("partial_claim_then_close",[init,operate,claim,close],partial),
 simulate("full_claim_then_close",[init,operate,claim,close],full),
]

# Construct an internally consistent outstanding-liability state directly on
# the fork. This models a claim created while liquid and a later vault drain;
# it is a handler/accounting test, not proof that the state transition is
# attacker-reachable.
reserve_value=account_value(reserve); reserve_base=base64.b64decode(reserve_value["data"][0])
claim_disc=bytes(specs["UserClaim"]["discriminator"]) if "UserClaim" in specs else bytes([228,142,195,181,228,147,32,209])
def set_account(address,data,owner,lamports,rent_epoch=0):
 response=rpc(LOCAL,"surfnet_setAccount",[str(address),{"data":data.hex(),"executable":False,"lamports":lamports,"owner":str(owner),"rentEpoch":rent_epoch}])
 if response.get("error"):raise RuntimeError(response["error"])
def seed_liability(amount,total_claim,vault_amount):
 claim_data=claim_disc+bytes(borrow_to)+amount.to_bytes(8,"little")+bytes(mint)
 reserve_data=bytearray(reserve_base);reserve_data[136:144]=total_claim.to_bytes(8,"little")
 set_account(claim_pda,claim_data,PROGRAM,2_000_000)
 set_account(reserve,bytes(reserve_data),Pubkey.from_string(reserve_value["owner"]),reserve_value["lamports"],reserve_value.get("rentEpoch",0))
 set_vault(vault_amount)
def simulate_seeded(name,ixs,amount,total_claim,vault_amount):
 seed_liability(amount,total_claim,vault_amount);pre_recipient=token_amount(raw_account(recipient_token));blockhash=Hash.from_string(rpc(LOCAL,"getLatestBlockhash",[{"commitment":"processed"}])["result"]["value"]["blockhash"])
 wire=base64.b64encode(bytes(Transaction.new_unsigned(Message.new_with_blockhash(ixs,payer,blockhash)))).decode();response=rpc(LOCAL,"simulateTransaction",[wire,{"encoding":"base64","sigVerify":False,"accounts":{"encoding":"base64","addresses":watched}}]);value=response.get("result",{}).get("value");accounts=value.get("accounts") if value else None;decoded=None
 if accounts:
  raws=[base64.b64decode(a["data"][0]) if a else None for a in accounts]
  decoded={"userClaimAmount":claim_amount(raws[0]),"reserveTotalClaim":reserve_claim(raws[1]),"vaultAmount":token_amount(raws[2]),"recipientAmount":token_amount(raws[3]),"recipientDelta":token_amount(raws[3])-pre_recipient if raws[3] else None,"claimDataLength":len(raws[0]) if raws[0] is not None else None}
 return {"case":name,"seededUserClaim":amount,"seededReserveTotalClaim":total_claim,"forkVaultStart":vault_amount,"err":value.get("err") if value else None,"unitsConsumed":value.get("unitsConsumed") if value else None,"post":decoded,"logs":value.get("logs") if value else None,"rpcError":response.get("error")}
synthetic_amount=1_000_000
synthetic=[
 simulate_seeded("seeded_full_claim",[claim],synthetic_amount,synthetic_amount,synthetic_amount+7),
 simulate_seeded("seeded_partial_liquidity_claim",[claim],synthetic_amount,synthetic_amount,synthetic_amount//2),
 simulate_seeded("seeded_duplicate_claim",[claim,claim],synthetic_amount,synthetic_amount,synthetic_amount+7),
 simulate_seeded("seeded_nonzero_claim_close",[close],synthetic_amount,synthetic_amount,synthetic_amount+7),
 simulate_seeded("seeded_claim_total_mismatch",[claim],synthetic_amount,synthetic_amount//2,synthetic_amount+7),
]
print(json.dumps({"program":str(PROGRAM),"sourceSignature":SIG,"sourceSlot":tx["slot"],"mint":str(mint),"liquidity":str(liquidity),"reserve":str(reserve),"vault":str(vault),"claimUser":str(borrow_to),"claimPda":str(claim_pda),"claimBump":bump,"borrowAmount":borrow_amount,"partialVaultAmount":partial,"fork":"Surfpool at 127.0.0.1:18999 backed by finalized mainnet RPC; cheatcodes only change fork state","liveSubmission":False,"reachableSequenceTests":results,"syntheticAccountingTests":synthetic,"syntheticLimitation":"seeded accounting states exercise the deployed handler but do not establish attacker reachability"},indent=2))
