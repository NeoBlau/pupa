show_code <- function(trigger) {
  if (trigger == "pupi") {
    cat(code_text)
  } else {
    cat("Введите правильную команду\n")
  }
}

code_text <- '
# 1. Загрузка и очистка данных
text <- "(102.05;159.3028), (164.97;165.2428), (156.28;164.9304), (198.31;169.5252), (205.13;175.4916), (179.25;168.3732), (207.09;183.3652), (182.87;189.0212), (204.96;169.672), (181.69;NA), (144;180.6344), (160.74;159.772), (202.03;169.2148), (194.91;165.4212), (186.59;168.7172), (187.2;176.904), (180.45;167.5052), (153.43;200.4836), (168.68;155.6384), (NA;173.2024), (181.07;162.106), (180.41;191.4716), (184.99;175.5388), (198.11;186.7228), (NA;187.8452), (184.17;180.3156), (188.05;162.4156), (178.68;194.784), (177.97;172.8376), (199.52;169.804)"

cleaned_text <- gsub("[()]", "", text)
cleaned_text <- gsub(";", ",", cleaned_text)
values <- unlist(strsplit(cleaned_text, ","))
values <- trimws(values)
num_values <- as.numeric(values)

X <- num_values[seq(1, length(num_values), 2)]
Y <- num_values[seq(2, length(num_values), 2)]

data <- data.frame(X, Y)
clean_data <- na.omit(data)

# 1.1 Объём выборки
n <- nrow(clean_data)

# 1.2 Коэффициент корреляции Пирсона
r <- cor(clean_data$X, clean_data$Y)

# 1.3 Наблюдаемое значение t-статистики
t_stat <- cor.test(clean_data$X, clean_data$Y)$statistic

# 1.4 p-value для корреляции
p_value_corr <- cor.test(clean_data$X, clean_data$Y)$p.value

# 1.5 Вывод по гипотезе о корреляции на уровне значимости 0.03
alpha1 <- 0.03
corr_significant <- ifelse(p_value_corr < alpha1, "да", "нет")

# 2. Оценка мат. ожидания X
mean_x <- mean(clean_data$X)

# 3. Проверка H0: E(X) = E(Y), p-value
t_test <- t.test(clean_data$X, clean_data$Y, paired = TRUE)
p_value_mean <- t_test$p.value
alpha2 <- 0.02
mean_significant <- ifelse(p_value_mean < alpha2, "да", "нет")

# 4. Проверка H0: Var(X) = Var(Y), p-value (односторонняя, Var(X) > Var(Y))
f_test <- var.test(clean_data$X, clean_data$Y, alternative = "greater")
p_value_var <- f_test$p.value
var_significant <- ifelse(p_value_var < alpha2, "да", "нет")

# === ВЫВОД РЕЗУЛЬТАТОВ (с полной точностью) ===
options(digits=22)

cat("----- ЧАСТЬ 1 -----\\n")
cat("1.1 Объем выборки после удаления пропусков: ", n, "\\n")
cat("1.2 Коэффициент корреляции: ", r, "\\n")
cat("1.3 Наблюдаемое значение Tнабл: ", t_stat, "\\n")
cat("1.4 P-value: ", p_value_corr, "\\n")
cat("1.5 Есть ли статистическая связь на уровне 0.03? ", corr_significant, "\\n\\n")

cat("----- ЧАСТЬ 2 -----\\n")
cat("2. Оценка мат. ожидания X: ", mean_x, "\\n\\n")

cat("----- ЧАСТЬ 3 -----\\n")
cat("3.1 P-value (сравнение средних): ", p_value_mean, "\\n")
cat("3.2 Есть ли основание отвергнуть H0? ", mean_significant, "\\n\\n")

cat("----- ЧАСТЬ 4 -----\\n")
cat("4.1 P-value (сравнение дисперсий): ", p_value_var, "\\n")
cat("4.2 Есть ли основание отвергнуть H0? ", var_significant, "\\n")
'

# Пример вызова:
show_code("pupi")
