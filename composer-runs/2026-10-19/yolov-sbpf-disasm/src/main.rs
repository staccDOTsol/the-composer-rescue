use solana_sbpf::{
    elf::Executable,
    memory_region::MemoryMapping,
    program::BuiltinProgram,
    static_analysis::Analysis,
    vm::ContextObject,
};
use std::{env, fs, ptr::NonNull, sync::Arc};

struct NoContext;

impl ContextObject for NoContext {
    fn consume(&mut self, _amount: u64) {}
    fn get_remaining(&self) -> u64 { 0 }
    fn active_mapping_ptr(&mut self) -> NonNull<MemoryMapping> { unreachable!() }
}

fn main() {
    let path = env::args().nth(1).expect("usage: yolov-sbpf-disasm <program.so>");
    let bytes = fs::read(path).expect("read program");
    let executable = Executable::<NoContext>::load(&bytes, Arc::new(BuiltinProgram::new_mock()))
        .expect("load SBF ELF");
    let (vaddr, text) = executable.get_text_bytes();
    eprintln!("text_vaddr={vaddr:#x} text_len={} entry_pc={}", text.len(), executable.get_entrypoint_instruction_offset());
    let analysis = Analysis::from_executable(&executable).expect("analyze");
    for (pc, insn) in analysis.instructions.iter().enumerate() {
        println!("{pc:05}  {}", analysis.disassemble_instruction(insn, pc));
    }
}
