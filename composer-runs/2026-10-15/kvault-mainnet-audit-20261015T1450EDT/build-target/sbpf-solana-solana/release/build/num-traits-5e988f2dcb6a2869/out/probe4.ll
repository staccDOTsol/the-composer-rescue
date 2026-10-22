; ModuleID = 'probe4.3fb17a93af976ed9-cgu.0'
source_filename = "probe4.3fb17a93af976ed9-cgu.0"
target datalayout = "e-m:e-p:64:64-i64:64-n32:64-S128"
target triple = "sbf"

@alloc_7971f3465817cc18ad816e3dbdd7087a = private unnamed_addr constant [7 x i8] c"<anon>\00", align 1
@alloc_b9b30cce65897495d8b789b323503a84 = private unnamed_addr constant <{ ptr, [16 x i8] }> <{ ptr @alloc_7971f3465817cc18ad816e3dbdd7087a, [16 x i8] c"\07\00\00\00\00\00\00\00\01\00\00\00\1F\00\00\00" }>, align 8

; probe4::probe
; Function Attrs: nounwind
define hidden void @_ZN6probe45probe17hf856632038b778c4E() unnamed_addr #0 {
start:
  ret void
}

; core::panicking::panic_const::panic_const_div_by_zero
; Function Attrs: cold noinline noreturn nounwind
declare void @_ZN4core9panicking11panic_const23panic_const_div_by_zero17h79d407179eb3033fE(ptr align 8) unnamed_addr #1

attributes #0 = { nounwind "target-cpu"="generic" "target-features"="+store-imm,+jmp-ext" }
attributes #1 = { cold noinline noreturn nounwind "target-cpu"="generic" "target-features"="+store-imm,+jmp-ext" }

!llvm.module.flags = !{!0}
!llvm.ident = !{!1}

!0 = !{i32 8, !"PIC Level", i32 2}
!1 = !{!"rustc version 1.89.0-dev"}
